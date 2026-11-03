#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <objc/message.h>

#ifndef EXPERIMENT_COMMIT
#define EXPERIMENT_COMMIT "development"
#endif

// Test process only: this deliberately substitutes an IM result, never a real IME trace.
@interface WKWebView (ExperimentTextInput)
- (void)insertText:(id)text replacementRange:(NSRange)range;
@end
@interface WKPreferences (ExperimentFeatures)
+ (NSArray *)_features;
- (BOOL)_isEnabledForFeature:(id)feature;
- (void)_setEnabled:(BOOL)enabled forFeature:(id)feature;
@end
@interface NSObject (ExperimentFeatureKey)
- (NSString *)key;
@end

@class Experiment;
static Experiment *current;
static IMP originalIMP;
static Class contextClass;
static SEL inputSelector(void) { return NSSelectorFromString(@"handleEventByInputMethod:completionHandler:"); }
typedef void (*InputIMP)(id, SEL, NSEvent *, void (^)(BOOL));

@interface Experiment : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webview;
@property(nonatomic, strong) id context;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic, strong) NSMutableArray *rows;
@property(nonatomic, strong) NSMutableArray *dom;
@property(nonatomic, strong) NSString *mode;
@property BOOL flag, delayed, loaded, busy, installed, finished, featureReadback, currentDown;
@property NSUInteger nativeCode, step, calls, callbacks, pending, insertCalls;
@property double started, deadline;
@property(nonatomic, strong) NSEvent *expectedEvent;
@property(nonatomic, strong) NSString *outputPath;
- (void)record:(NSDictionary *)row;
- (void)finish:(NSString *)status reason:(NSString *)reason;
- (void)receiveContext:(id)receiver event:(NSEvent *)event completion:(void (^)(BOOL))completion;
@end

static void controlledInput(id receiver, SEL cmd, NSEvent *event, void (^completion)(BOOL)) {
    Experiment *p = current;
    if (p && !p.finished && receiver == p.context && event == p.expectedEvent) {
        [p receiveContext:receiver event:event completion:completion];
        return;
    }
    ((InputIMP)originalIMP)(receiver, cmd, event, completion);
}

@implementation Experiment
- (void)record:(NSDictionary *)row {
    if (self.finished || self.rows.count >= 200) return;
    NSMutableDictionary *r = [row mutableCopy];
    r[@"seq"] = @(self.rows.count);
    r[@"ms"] = @((NSProcessInfo.processInfo.systemUptime - self.started) * 1000);
    [self.rows addObject:r];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.started = NSProcessInfo.processInfo.systemUptime;
    self.deadline = self.started + 12;
    self.rows = [NSMutableArray array]; self.dom = [NSMutableArray array];
    NSUserDefaults *args = NSUserDefaults.standardUserDefaults;
    self.flag = [args boolForKey:@"flag"];
    self.delayed = [args boolForKey:@"delayed"];
    self.mode = [args stringForKey:@"mode"];
    self.nativeCode = [args integerForKey:@"side"] == 60 ? 60 : 56;
    self.outputPath = [args stringForKey:@"output"];
    if (![@[@"true-none", @"true-empty", @"false-none"] containsObject:self.mode] || !self.outputPath) {
        [self finish:@"error" reason:@"invalid-fixed-case-arguments"]; return;
    }
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    if (![WKPreferences respondsToSelector:@selector(_features)] ||
        ![config.preferences respondsToSelector:@selector(_setEnabled:forFeature:)] ||
        ![config.preferences respondsToSelector:@selector(_isEnabledForFeature:)]) {
        [self finish:@"unsupported" reason:@"feature-selectors-unavailable"]; return;
    }
    id selected = nil;
    for (id feature in [WKPreferences _features]) {
        if ([feature respondsToSelector:@selector(key)] && [[feature key] isEqual:@"InputMethodUsesCorrectKeyEventOrder"]) selected = feature;
    }
    if (!selected) { [self finish:@"unsupported" reason:@"feature-not-enumerated"]; return; }
    [config.preferences _setEnabled:self.flag forFeature:selected];
    self.featureReadback = [config.preferences _isEnabledForFeature:selected];
    if (self.featureReadback != self.flag) { [self finish:@"unsupported" reason:@"feature-readback-mismatch"]; return; }
    [config.userContentController addScriptMessageHandler:self name:@"result"];
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    self.webview = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webview.navigationDelegate = self; self.window.contentView = self.webview;
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
    NSString *html = @"<!doctype html><meta charset=utf-8><input id=sample autocomplete=off><script>for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{if(e.code==='ShiftLeft'||e.code==='ShiftRight')webkit.messageHandlers.result.postMessage({type:e.type,code:e.code,keyCode:[16,229].includes(e.keyCode)?e.keyCode:null,trusted:e.isTrusted,composing:e.isComposing,length:sample.value.length});},true);</script>";
    [self.webview loadHTMLString:html baseURL:nil];
    __weak Experiment *weak = self;
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.025 repeats:YES block:^(NSTimer *timer) { [weak tick]; }];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    [webView evaluateJavaScript:@"sample.focus(); document.activeElement === sample" completionHandler:^(id result, NSError *error) {
        if (!error && [result boolValue]) self.loaded = YES;
    }];
}
- (BOOL)install {
    id ctx = self.webview.inputContext;
    if (!ctx) return NO;
    Class cls = object_getClass(ctx); Method inherited = class_getInstanceMethod(cls, inputSelector());
    char ret[16] = {0}, arg[16] = {0}, block[16] = {0};
    if (inherited) { method_getReturnType(inherited, ret, 16); method_getArgumentType(inherited, 2, arg, 16); method_getArgumentType(inherited, 3, block, 16); }
    if (!inherited || method_getNumberOfArguments(inherited) != 4 || strcmp(ret, "v") || arg[0] != '@' || strcmp(block, "@?")) {
        [self finish:@"unsupported" reason:@"context-selector-ABI"]; return NO;
    }
    originalIMP = method_getImplementation(inherited);
    class_addMethod(cls, inputSelector(), originalIMP, method_getTypeEncoding(inherited));
    unsigned count = 0; Method *methods = class_copyMethodList(cls, &count); Method own = NULL;
    for (unsigned i = 0; i < count; i++) if (method_getName(methods[i]) == inputSelector()) own = methods[i];
    free(methods);
    if (!own) { [self finish:@"unsupported" reason:@"own-method-slot-missing"]; return NO; }
    self.context = ctx; contextClass = cls; current = self;
    method_setImplementation(own, (IMP)controlledInput); self.installed = YES;
    [self record:@{@"source": @"installed", @"contextClass": NSStringFromClass(cls), @"featureReadback": @(self.featureReadback)}];
    return YES;
}
- (void)tick {
    if (self.finished) return;
    if (NSProcessInfo.processInfo.systemUptime > self.deadline) { [self finish:@"error" reason:self.installed ? @"event-or-callback-timeout" : @"focus-or-context-timeout"]; return; }
    if (!self.loaded || self.busy) return;
    if (!self.installed && ![self install]) return;
    if (self.step == 4) {
        if (self.calls != 4 || self.callbacks != 4 || self.pending || self.dom.count != 4) { [self finish:@"error" reason:@"count-mismatch"]; return; }
        [self finish:@"complete" reason:@"synthetic-context-not-native-IME"]; return;
    }
    self.currentDown = (self.step % 2 == 0); self.busy = YES;
    self.expectedEvent = [NSEvent keyEventWithType:NSEventTypeFlagsChanged location:NSZeroPoint
        modifierFlags:self.currentDown ? NSEventModifierFlagShift : 0 timestamp:NSProcessInfo.processInfo.systemUptime
        windowNumber:self.window.windowNumber context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:self.nativeCode];
    [self record:@{@"source": @"native-post", @"step": @(self.step), @"down": @(self.currentDown), @"nativeKeyCode": @(self.nativeCode)}];
    self.deadline = NSProcessInfo.processInfo.systemUptime + 5;
    [NSApp postEvent:self.expectedEvent atStart:NO];
}
- (void)receiveContext:(id)receiver event:(NSEvent *)event completion:(void (^)(BOOL))completion {
    self.calls++; self.pending++;
    NSUInteger call = self.calls, step = self.step;
    [self record:@{@"source": @"controlled-context-entry", @"call": @(call), @"step": @(step), @"sameNativeObject": @YES}];
    if (!completion) { [self finish:@"error" reason:@"missing-completion"]; return; }
    void (^reply)(void) = ^{
        if (self.finished) return;
        if (self.currentDown && [self.mode isEqual:@"true-empty"]) {
            self.insertCalls++;
            [self record:@{@"source": @"synthetic-insertText", @"call": @(call), @"length": @0}];
            [self.webview insertText:@"" replacementRange:NSMakeRange(NSNotFound, 0)];
        }
        BOOL handled = ![self.mode isEqual:@"false-none"];
        self.callbacks++; self.pending--;
        [self record:@{@"source": @"controlled-completion", @"call": @(call), @"handled": @(handled)}];
        completion(handled);
    };
    if (self.delayed) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_MSEC), dispatch_get_main_queue(), reply);
    else reply();
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (self.finished || ![message.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *b = message.body;
    // Fixed synthetic window only; whitelist even though no user input is involved.
    if (![@[@"keydown", @"keyup"] containsObject:b[@"type"]] || ![@[@"ShiftLeft", @"ShiftRight"] containsObject:b[@"code"]]) return;
    NSMutableDictionary *row = [@{@"source": @"DOM", @"step": @(self.step), @"type": b[@"type"], @"code": b[@"code"]} mutableCopy];
    for (NSString *key in @[@"keyCode", @"trusted", @"composing", @"length"]) row[key] = b[key] ?: NSNull.null;
    [self record:row]; [self.dom addObject:row];
    if (!self.busy || ![b[@"type"] isEqual:self.currentDown ? @"keydown" : @"keyup"] || self.pending || self.callbacks != self.step + 1) {
        [self finish:@"error" reason:@"unexpected-DOM-order-or-pending-callback"]; return;
    }
    self.step++; self.busy = NO; self.expectedEvent = nil;
}
- (void)finish:(NSString *)status reason:(NSString *)reason {
    if (self.finished) return;
    self.finished = YES; [self.timer invalidate];
    if (self.installed) {
        Method method = class_getInstanceMethod(contextClass, inputSelector());
        if (method_getImplementation(method) == (IMP)controlledInput) method_setImplementation(method, originalIMP);
        else { status = @"error"; reason = @"restore-conflict"; }
    }
    current = nil;
    NSDictionary *result = @{@"schema": @1, @"experiment": @"controlled-wk-shift-v1", @"commit": @EXPERIMENT_COMMIT,
        @"synthetic": @YES, @"nativeIMEVerified": @NO, @"status": status, @"reason": reason,
        @"flagRequested": @(self.flag), @"flagReadback": @(self.featureReadback), @"mode": self.mode ?: @"invalid",
        @"delayed": @(self.delayed), @"side": @(self.nativeCode), @"calls": @(self.calls), @"callbacks": @(self.callbacks),
        @"pending": @(self.pending), @"insertCalls": @(self.insertCalls), @"rows": self.rows ?: @[],
        @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
        @"webKit": [[NSBundle bundleForClass:WKWebView.class] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown"};
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    BOOL saved = self.outputPath && [data writeToFile:self.outputPath atomically:YES];
    printf("%s flag=%d mode=%s delayed=%d side=%lu calls=%lu callbacks=%lu reason=%s\n", status.UTF8String, self.flag, self.mode.UTF8String ?: "invalid", self.delayed, (unsigned long)self.nativeCode, (unsigned long)self.calls, (unsigned long)self.callbacks, reason.UTF8String);
    fflush(stdout);
    exit(saved && [status isEqual:@"complete"] ? 0 : [status isEqual:@"unsupported"] ? 3 : 2);
}
@end
int main(void) { @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication; [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    Experiment *delegate = [Experiment new]; app.delegate = delegate; [app run];
} return 0; }
