package ai.openidea.usages;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.internal.corext.codemanipulation.GetterSetterUtil;
import org.eclipse.jdt.ls.core.internal.IDelegateCommandHandler;
import org.eclipse.jdt.ls.core.internal.JDTUtils;
import org.eclipse.jdt.ls.core.internal.JavaLanguageServerPlugin;
import org.eclipse.jdt.ls.core.internal.handlers.ReferencesHandler;
import org.eclipse.lsp4j.*;

/** Classifies search results using JDT method identities, never reference text. */
public final class UsagesCommand implements IDelegateCommandHandler {
    @Override
    public Object executeCommand(String command, List<Object> arguments, IProgressMonitor monitor) throws Exception {
        String uri = (String) arguments.get(0);
        int line = ((Number) arguments.get(1)).intValue();
        int column = ((Number) arguments.get(2)).intValue();
        boolean declarations = Boolean.TRUE.equals(arguments.get(3));
        var preferences = JavaLanguageServerPlugin.getPreferencesManager();
        var handler = new ReferencesHandler(preferences);
        var params = new ReferenceParams(new TextDocumentIdentifier(uri), new Position(line, column), new ReferenceContext(declarations));
        Map<Location, String> results = new LinkedHashMap<>();
        for (var location : handler.findReferences(params, monitor)) results.put(location, "unknown");
        ITypeRoot root = JDTUtils.resolveTypeRoot(uri);
        if (root != null) {
            IJavaElement selected = JDTUtils.findElementAtSelection(root, line, column, preferences, monitor);
            if (selected instanceof IField field) {
                add(handler, field, "field", declarations, results, monitor);
                if (preferences.getPreferences().isIncludeAccessors()) {
                    add(handler, GetterSetterUtil.getGetter(field), "getter", false, results, monitor);
                    add(handler, GetterSetterUtil.getSetter(field), "setter", false, results, monitor);
                    addConfiguredAccessors(handler, field, results, monitor);
                }
            }
        }
        if (monitor.isCanceled()) throw new org.eclipse.core.runtime.OperationCanceledException();
        List<Map<String, Object>> response = new ArrayList<>();
        results.forEach((location, kind) -> response.add(Map.of("location", location, "kind", kind)));
        return response;
    }

    /** Resolve explicit Lombok @Accessors naming, then search exact JDT method identities.
     * Configuration-file-only naming is deliberately not guessed.
     */
    private static void addConfiguredAccessors(ReferencesHandler handler, IField field, Map<Location, String> results,
            IProgressMonitor monitor) throws Exception {
        Boolean fluent = null;
        boolean configured = false;
        String[] prefixes = null;
        // Field annotations override enclosing type annotations, as Lombok does.
        List<IAnnotatable> owners = new ArrayList<>();
        owners.add(field);
        for (IType type = field.getDeclaringType(); type != null; type = type.getDeclaringType()) owners.add(type);
        for (IAnnotatable owner : owners) {
            for (IAnnotation annotation : owner.getAnnotations()) {
                String name = annotation.getElementName();
                if (!name.equals("Accessors") && !name.equals("lombok.experimental.Accessors")) continue;
                String[][] resolved = field.getDeclaringType().resolveType(name);
                if (!name.equals("lombok.experimental.Accessors") && (resolved == null || resolved.length != 1 ||
                        !resolved[0][0].equals("lombok.experimental") || !resolved[0][1].equals("Accessors"))) continue;
                configured = true;
                for (IMemberValuePair pair : annotation.getMemberValuePairs()) {
                    if (pair.getMemberName().equals("fluent") && fluent == null && pair.getValue() instanceof Boolean value) fluent = value;
                    if (pair.getMemberName().equals("prefix") && prefixes == null) {
                        Object value = pair.getValue();
                        if (value instanceof String prefix) prefixes = new String[] { prefix };
                        else if (value instanceof Object[] values) {
                            prefixes = new String[values.length];
                            for (int i = 0; i < values.length; i++) prefixes[i] = (String) values[i];
                        }
                    }
                }
            }
        }
        if (!configured) return;
        String name = field.getElementName();
        if (prefixes != null && prefixes.length > 0) {
            String stripped = null;
            for (String prefix : prefixes) {
                if (prefix.isEmpty()) { stripped = name; break; }
                if (!name.startsWith(prefix) || name.length() == prefix.length()) continue;
                char next = name.charAt(prefix.length());
                if (Character.isLetter(prefix.charAt(prefix.length() - 1)) && Character.isLowerCase(next)) continue;
                stripped = Character.toLowerCase(next) + name.substring(prefix.length() + 1);
                break;
            }
            if (stripped == null) return;
            name = stripped;
        }
        String signature = field.getTypeSignature();
        String getterName = name;
        String setterName = name;
        if (!Boolean.TRUE.equals(fluent)) {
            boolean bool = signature.equals(Signature.SIG_BOOLEAN);
            String base = name;
            if (bool && base.startsWith("is") && base.length() > 2 && Character.isUpperCase(base.charAt(2))) base = base.substring(2);
            String capital = Character.toUpperCase(base.charAt(0)) + base.substring(1);
            getterName = (bool ? "is" : "get") + capital;
            setterName = "set" + capital;
        }
        for (IMethod method : field.getDeclaringType().getMethods()) {
            if (Flags.isStatic(method.getFlags()) != Flags.isStatic(field.getFlags())) continue;
            if (method.getElementName().equals(getterName) && method.getNumberOfParameters() == 0 && method.getReturnType().equals(signature)) {
                add(handler, method, "getter", false, results, monitor);
            } else if (method.getElementName().equals(setterName) && method.getNumberOfParameters() == 1 && method.getParameterTypes()[0].equals(signature) && setterReturnType(method)) {
                add(handler, method, "setter", false, results, monitor);
            }
        }
    }

    private static boolean setterReturnType(IMethod method) throws JavaModelException {
        String result = method.getReturnType();
        if (result.equals(Signature.SIG_VOID)) return true;
        String name = Signature.toString(Signature.getTypeErasure(result));
        IType owner = method.getDeclaringType();
        if (name.equals(owner.getFullyQualifiedName())) return true;
        String[][] resolved = owner.resolveType(name);
        return resolved != null && resolved.length == 1 &&
            (resolved[0][0].isEmpty() ? resolved[0][1] : resolved[0][0] + "." + resolved[0][1]).equals(owner.getFullyQualifiedName());
    }

    private static void add(ReferencesHandler handler, IJavaElement element, String kind, boolean declarations,
            Map<Location, String> results, IProgressMonitor monitor) throws Exception {
        if (element == null) return;
        List<Location> locations = new ArrayList<>();
        handler.search(element, locations, monitor, declarations);
        for (var location : locations) {
            String previous = results.get(location);
            results.put(location, previous == null || previous.equals("unknown") || previous.equals(kind) ? kind : "unknown");
        }
    }
}
