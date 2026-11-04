#import "Probe.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <math.h>
#import <Carbon/Carbon.h>
#ifndef OI_COMMIT
#define OI_COMMIT "development"
#endif
#ifndef OI_HTML_SHA
#define OI_HTML_SHA "development"
#endif
static const NSUInteger Limit = 6000;
static BOOL shiftEvent(NSEvent *e) { return e && (e.type == NSEventTypeFlagsChanged || e.type == NSEventTypeKeyDown || e.type == NSEventTypeKeyUp) && (e.keyCode == 56 || e.keyCode == 60); }
static BOOL targetWindow(NSWindow *eventWindow, NSWindow *testWindow, NSWindow *keyWindow) { return testWindow && (eventWindow==testWindow || (!eventWindow && keyWindow==testWindow)); }
static NSString *eventType(NSEvent *e) { switch(e.type) {case NSEventTypeFlagsChanged:return @"flagsChanged";case NSEventTypeKeyDown:return @"keyDown";case NSEventTypeKeyUp:return @"keyUp";default:return @"other";} }
static BOOL enumValue(id value, NSArray *allowed) {return [value isKindOfClass:NSString.class] && [allowed containsObject:value];}
static id number(id v) {return [v isKindOfClass:NSNumber.class] && isfinite([v doubleValue]) && [v doubleValue]>=0 && [v doubleValue]<1e12 ? v : NSNull.null;}
static id boolean(id v) {return [v isKindOfClass:NSNumber.class] ? @([v boolValue]) : NSNull.null;}
static NSDictionary *safeDOM(NSDictionary *b) {
 if (!enumValue(b[@"type"], @[@"keydown",@"keyup"]) || !enumValue(b[@"code"], @[@"ShiftLeft",@"ShiftRight"])) return nil;
 NSMutableDictionary *r=[@{@"source":@"dom-window-capture",@"type":b[@"type"],@"code":b[@"code"]} mutableCopy];
 for(NSString *k in @[@"keyCode",@"prototypeCode"])r[k]=[b[k] isKindOfClass:NSNumber.class] && ([b[k] integerValue]==16 || [b[k] integerValue]==229)?b[k]:NSNull.null;
 for(NSString *k in @[@"ownCode",@"trusted",@"composing",@"shift",@"ctrl",@"alt",@"meta"])r[k]=boolean(b[k]);
 for(NSString *k in @[@"phase",@"pageMs",@"order",@"length"])r[k]=number(b[k]);
 return r;
}
// Only these fixed categories leave this function. Never buffer a raw input-source ID/name.
static NSString *sourceFamily(id identifier, id bundle) {
    NSString *i=[identifier isKindOfClass:NSString.class]?[identifier lowercaseString]:@"";
    NSString *b=[bundle isKindOfClass:NSString.class]?[bundle lowercaseString]:@"";
    if([i isEqual:@"com.apple.keylayout.abc"])return @"abc";
    if([i hasPrefix:@"com.apple.inputmethod.scim."] || [i hasPrefix:@"com.apple.inputmethod.tcim."] || [b isEqual:@"com.apple.inputmethod.scim"] || [b isEqual:@"com.apple.inputmethod.tcim"])return @"builtin-chinese";
    if([i hasPrefix:@"com.sogou.inputmethod."] || [b hasPrefix:@"com.sogou.inputmethod."])return @"sogou";
    return @"unknown";
}
static NSString *currentSourceFamily(void) {
    TISInputSourceRef source=TISCopyCurrentKeyboardInputSource();
    if(!source)return @"unknown";
    CFTypeRef identifier=TISGetInputSourceProperty(source,kTISPropertyInputSourceID);
    CFTypeRef bundle=TISGetInputSourceProperty(source,kTISPropertyBundleID);
    NSString *family=sourceFamily(identifier && CFGetTypeID(identifier)==CFStringGetTypeID()?(__bridge id)identifier:nil,bundle && CFGetTypeID(bundle)==CFStringGetTypeID()?(__bridge id)bundle:nil);
    CFRelease(source);return family;
}
@interface OIProbe ()
@property(nonatomic) BOOL active, advanced, focusConfirmed, focusQueryInFlight, everReady;
@property(nonatomic) BOOL selfTestAwaitingClose;
@property(nonatomic) NSUInteger generation, epoch, dropped, nextEvent, nextCall, contextChecks, focusRevision;
@property(nonatomic) double startTime, deadline;
@property(nonatomic,strong) NSNumber *firstReadyMs, *installedMs;
@property(nonatomic,strong) NSMutableArray *rows;
@property(nonatomic,strong) NSMutableDictionary *calls, *textCalls;
@property(nonatomic) NSUInteger nextTextCall, synchronousContextCall;
@property(nonatomic,strong) NSMapTable *eventIDs;
@property(nonatomic,strong) id monitor, closeObserver;
@property(nonatomic,strong) NSTimer *readinessTimer;
@property(nonatomic,copy) NSString *host, *label, *capability, *state, *endState, *sessionID, *sourceAtStart;
@property(nonatomic,weak) id trackedContext;
@property(nonatomic) Class hookedClass;
@property(nonatomic) IMP original;
- (BOOL)ready;
- (void)record:(NSDictionary *)record;
- (NSDictionary *)nativeEvent:(NSEvent *)event source:(NSString *)source;
- (void)start:(NSString *)label advanced:(BOOL)advanced;
- (void)advanceReadiness;
- (void)requestFocusConfirmation;
- (void)focusChanged:(BOOL)focused;
- (void)detachHook;
- (NSDictionary *)snapshot;
- (NSString *)exportName;
- (void)status;
@end
static void selfTest(OIProbe *probe);
static __weak OIProbe *activeProbe;
static NSMutableDictionary<NSValue *,NSValue *> *originals;
static SEL inputSelector(void) {return NSSelectorFromString(@"handleEventByInputMethod:completionHandler:");}
typedef void (*InputIMP)(id, SEL, NSEvent *, void (^)(BOOL));
// Forward original invocation and every original callback once, on their original threads.
static void observeInput(id receiver, SEL cmd, NSEvent *event, void (^completion)(BOOL)) {
    IMP imp=NULL;
    @synchronized(OIProbe.class) {
        for(Class c=object_getClass(receiver);c && !imp;c=class_getSuperclass(c))
            imp=[originals[[NSValue valueWithPointer:(__bridge const void *)c]] pointerValue];
    }
    if(!NSThread.isMainThread){((InputIMP)imp)(receiver,cmd,event,completion);return;}
    OIProbe *p=activeProbe;
    if(!p.active || !p.ready || receiver!=p.trackedContext || !shiftEvent(event)) {
        ((InputIMP)imp)(receiver,cmd,event,completion);return;
    }
    NSUInteger generation=p.generation, epoch=p.epoch, call=++p.nextCall;
    NSString *callKey=[NSString stringWithFormat:@"%lu",(unsigned long)call];
    p.calls[callKey]=@0;
    NSMutableDictionary *entry=[[p nativeEvent:event source:@"input-context-enter"] mutableCopy];
    entry[@"call"]=@(call);[p record:entry];
    __weak OIProbe *weak=p;
    void (^forward)(BOOL)=completion ? ^(BOOL handled) {
        double when=NSProcessInfo.processInfo.systemUptime;BOOL main=NSThread.isMainThread;
        void (^log)(void)=^{
            OIProbe *s=weak;
            if(s.active && s.generation==generation && s.calls[callKey]) {
                s.calls[callKey]=@([s.calls[callKey] unsignedIntegerValue]+1);
                [s record:@{@"source":@"input-context-completion",@"call":@(call),@"handled":@(handled),
                    @"callEpoch":@(epoch),@"sameReadyEpoch":@(s.ready && s.epoch==epoch),
                    @"callbackUptimeMs":@(when*1000),@"callbackThread":main?@"main":@"other"}];
            }
        };
        if(main)log();else dispatch_async(dispatch_get_main_queue(),log);
        completion(handled);
    } : nil;
    NSUInteger previous=p.synchronousContextCall;p.synchronousContextCall=call;
    @try{((InputIMP)imp)(receiver,cmd,event,forward);}@finally{p.synchronousContextCall=previous;}
}
static BOOL supportedMethod(Method m) {
    if(!m || method_getNumberOfArguments(m)!=4)return NO;
    char ret[32]={0},event[32]={0},block[32]={0};
    method_getReturnType(m,ret,32);method_getArgumentType(m,2,event,32);method_getArgumentType(m,3,block,32);
    return !strcmp(ret,"v") && event[0]=='@' && !strcmp(block,"@?");
}
@implementation OIProbe
- (instancetype)initWithHost:(NSString *)host {
    if((self=[super init])) {
        _host=host;_rows=[NSMutableArray array];_calls=[NSMutableDictionary dictionary];
        _textCalls=[NSMutableDictionary dictionary];_featureInfo=@{};_textCapabilities=@{};
        _capability=@"disabled";_state=@"idle";_endState=@"idle";_label=@"unselected";
        _sessionID=@"none";_sourceAtStart=@"unknown";
        _eventIDs=[NSMapTable mapTableWithKeyOptions:NSPointerFunctionsWeakMemory|NSPointerFunctionsObjectPointerPersonality valueOptions:NSPointerFunctionsStrongMemory];
    }
    return self;
}
- (NSUInteger)sessionGeneration {return self.generation;}
- (NSUInteger)beginTextCall:(NSString *)selector metadata:(NSDictionary *)metadata {
    if(!NSThread.isMainThread || !self.active || !self.advanced)return 0;
    NSUInteger call=++self.nextTextCall;self.textCalls[@(call).stringValue]=@0;
    NSMutableDictionary *r=[metadata mutableCopy];r[@"source"]=@"text-client-enter";r[@"selector"]=selector;r[@"textCall"]=@(call);r[@"synchronousContextCall"]=@(self.synchronousContextCall);
    NSMutableArray *pending=[NSMutableArray array];for(NSString *key in self.calls)if([self.calls[key] unsignedIntegerValue]==0)[pending addObject:key];r[@"pendingContextCalls"]=pending;
    [self record:r];return call;
}
- (void)endTextCall:(NSUInteger)call metadata:(NSDictionary *)metadata {
    if(!call || !self.active || !self.textCalls[@(call).stringValue])return;
    self.textCalls[@(call).stringValue]=@([self.textCalls[@(call).stringValue] unsignedIntegerValue]+1);
    NSMutableDictionary *r=[metadata mutableCopy];r[@"source"]=@"text-client-return";r[@"textCall"]=@(call);[self record:r];
}
- (void)dispose {
    [self stop];[self.webview.configuration.userContentController removeScriptMessageHandlerForName:@"nativeDiagnostic"];
    if(self.closeObserver)[NSNotificationCenter.defaultCenter removeObserver:self.closeObserver];self.closeObserver=nil;self.changeMode=nil;
}
- (BOOL)ready {return self.active && self.focusConfirmed && ([self.state isEqual:@"ready-baseline"] || [self.state isEqual:@"ready-advanced"]);}
- (void)attach:(WKWebView *)webview {
    self.webview=webview;[webview.configuration.userContentController addScriptMessageHandler:self name:@"nativeDiagnostic"];
    __weak OIProbe *weak=self;
    self.closeObserver=[NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification object:webview.window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *n){
        (void)n;OIProbe *p=weak;[p stop];
        if(p.selfTestAwaitingClose) {
            if(p.active || p.monitor || p.readinessTimer || p.hookedClass){fprintf(stderr,"FAIL close cleanup\n");exit(17);}
            printf("PASS v5 packaged cold-start real WK event/callback/stop/baseline/export-cancel/close; synthetic native events only\n");fflush(stdout);exit(0);
        }
    }];
    NSString *content=[NSString stringWithContentsOfURL:[NSBundle.mainBundle URLForResource:@"index" withExtension:@"html"] encoding:NSUTF8StringEncoding error:nil];
    [webview loadHTMLString:content?:@"<h1>Missing diagnostic page</h1>" baseURL:nil];
    if([NSProcessInfo.processInfo.arguments containsObject:@"--diagnostic-self-test"])selfTest(self);
}
- (void)record:(NSDictionary *)record {
    if(!self.active)return;
    if(self.rows.count>=Limit){self.dropped++;[self stop];return;}
    NSMutableDictionary *r=[record mutableCopy];r[@"seq"]=@(self.rows.count);
    r[@"nativeReceiveMs"]=@((NSProcessInfo.processInfo.systemUptime-self.startTime)*1000);
    r[@"readiness"]=self.state;r[@"sampleEligible"]=@(self.ready);r[@"epoch"]=@(self.epoch);
    [self.rows addObject:r];
}
- (NSDictionary *)nativeEvent:(NSEvent *)e source:(NSString *)source {
    NSNumber *identity=[self.eventIDs objectForKey:e];if(!identity){identity=@(++self.nextEvent);[self.eventIDs setObject:identity forKey:e];}
    NSEventModifierFlags f=e.modifierFlags;id responder=self.webview.window.firstResponder;
    NSString *kind=responder==self.webview?@"webview":[responder isKindOfClass:NSTextView.class]?@"text-view":@"other";
    return @{@"source":source,@"eventWindow":e.window==self.webview.window?@"test-window":e.window?@"other-window":@"none",@"eventID":identity,
        @"eventUptimeMs":@(e.timestamp*1000),@"type":eventType(e),@"nativeKeyCode":@(e.keyCode),
        @"shift":@((f&NSEventModifierFlagShift)!=0),@"ctrl":@((f&NSEventModifierFlagControl)!=0),@"alt":@((f&NSEventModifierFlagOption)!=0),@"meta":@((f&NSEventModifierFlagCommand)!=0),
        @"firstResponder":kind,@"keyWindow":@(self.webview.window.isKeyWindow),@"inputSourceFamily":currentSourceFamily()};
}
- (void)setPhase:(NSString *)state capability:(NSString *)capability {
    BOOL changed=![state isEqual:self.state] || ![capability isEqual:self.capability];
    self.state=state;self.capability=capability;
    if(changed){[self record:@{@"source":@"readiness-transition",@"contextChecks":@(self.contextChecks),@"capability":capability}];[self status];}
}
- (void)failReadiness:(NSString *)reason {
    [self.readinessTimer invalidate];self.readinessTimer=nil;[self detachHook];
    [self setPhase:@"failed" capability:reason];
}
- (BOOL)installHookOnContext:(id)context {
    Class cls=object_getClass(context);SEL sel=inputSelector();Method m=class_getInstanceMethod(cls,sel);
    if(!supportedMethod(m)){[self failReadiness:@"unsupported-selector-or-ABI"];return NO;}
    IMP original=method_getImplementation(m);
    if(original==(IMP)observeInput){[self failReadiness:@"already-wrapped"];return NO;}
    class_addMethod(cls,sel,original,method_getTypeEncoding(m));
    Method own=NULL;unsigned int count=0;Method *methods=class_copyMethodList(cls,&count);
    for(unsigned int i=0;i<count;i++)if(method_getName(methods[i])==sel)own=methods[i];free(methods);
    if(!own){[self failReadiness:@"unavailable-own-method-slot"];return NO;}
    @synchronized(OIProbe.class) {
        if(!originals)originals=[NSMutableDictionary dictionary];
        originals[[NSValue valueWithPointer:(__bridge const void *)cls]]=[NSValue valueWithPointer:original];
    }
    self.trackedContext=context;self.hookedClass=cls;self.original=original;activeProbe=self;
    method_setImplementation(own,(IMP)observeInput);self.epoch++;
    self.installedMs=@((NSProcessInfo.processInfo.systemUptime-self.startTime)*1000);
    return YES;
}
- (void)detachHook {
    if(self.hookedClass) {
        Method m=class_getInstanceMethod(self.hookedClass,inputSelector());
        if(method_getImplementation(m)==(IMP)observeInput)method_setImplementation(m,self.original);
        else self.capability=@"restore-conflict";
        self.hookedClass=Nil;
    }
    if(activeProbe==self)activeProbe=nil;self.trackedContext=nil;
}
- (void)ensureTimer {
    if(self.readinessTimer || !self.active || [self.state isEqual:@"failed"])return;
    NSUInteger generation=self.generation;__weak OIProbe *weak=self;
    self.readinessTimer=[NSTimer timerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *timer){
        OIProbe *p=weak;if(!p || !p.active || p.generation!=generation){[timer invalidate];return;}[p advanceReadiness];
    }];
    [NSRunLoop.mainRunLoop addTimer:self.readinessTimer forMode:NSRunLoopCommonModes];
}
- (void)requestFocusConfirmation {
    if(!self.active || self.focusQueryInFlight)return;
    self.focusQueryInFlight=YES;NSUInteger generation=self.generation, revision=self.focusRevision;__weak OIProbe *weak=self;
    [self.webview evaluateJavaScript:@"document.activeElement === document.getElementById('sample')" completionHandler:^(id result,NSError *error){
        OIProbe *p=weak;if(!p.active || p.generation!=generation)return;
        p.focusQueryInFlight=NO;if(p.focusRevision!=revision)return;
        if(!error && [result isKindOfClass:NSNumber.class] && [result boolValue]){p.focusConfirmed=YES;[p advanceReadiness];}
    }];
}
- (void)advanceReadiness {
    if(!self.active || [self.state isEqual:@"failed"])return;
    double now=NSProcessInfo.processInfo.systemUptime;
    if(!self.ready && now>=self.deadline){[self failReadiness:self.focusConfirmed?@"timeout-input-context":@"timeout-focus"];return;}
    if(!self.focusConfirmed){[self requestFocusConfirmation];return;}
    if(!self.advanced) {
        if(!self.everReady)self.firstReadyMs=@((now-self.startTime)*1000);self.everReady=YES;
        [self setPhase:@"ready-baseline" capability:@"disabled"];
        [self.readinessTimer invalidate];self.readinessTimer=nil;return;
    }
    self.contextChecks++;id context=self.webview.inputContext;
    if(self.hookedClass && (!context || !self.trackedContext || context!=self.trackedContext)) {
        [self detachHook];if([self.capability isEqual:@"restore-conflict"]){[self failReadiness:@"restore-conflict"];return;}self.epoch++;self.deadline=now+3.0;
        [self setPhase:@"arming-context" capability:@"context-changed"];
        return; // Never silently attribute the transition's event to the old ready epoch.
    }
    if(self.hookedClass)return;
    if(!context){[self setPhase:@"arming-context" capability:@"waiting-input-context"];return;}
    if([self installHookOnContext:context]) {
        if(!self.everReady)self.firstReadyMs=@((now-self.startTime)*1000);self.everReady=YES;
        [self setPhase:@"ready-advanced" capability:@"installed"];
    }
}
- (void)focusChanged:(BOOL)focused {
    if(!self.active || [self.state isEqual:@"failed"] || self.focusConfirmed==focused)return;
    self.focusRevision++;self.focusConfirmed=focused;
    if(!focused){[self detachHook];self.epoch++;self.deadline=NSProcessInfo.processInfo.systemUptime+3.0;[self setPhase:@"arming-focus" capability:@"waiting-focus"];}
    [self ensureTimer];[self advanceReadiness];
}
- (void)start:(NSString *)label advanced:(BOOL)advanced {
    if(!enumValue(label,@[@"abc",@"builtin-chinese",@"sogou-chinese",@"sogou-english"])) {
        if(!self.active){self.capability=@"label-required";[self status];}return;
    }
    [self stop];self.generation++;self.epoch=0;self.rows=[NSMutableArray array];self.calls=[NSMutableDictionary dictionary];[self.eventIDs removeAllObjects];
    self.nextEvent=0;self.nextCall=0;self.nextTextCall=0;self.textCalls=[NSMutableDictionary dictionary];self.dropped=0;self.contextChecks=0;self.label=label;self.advanced=advanced;
    self.focusConfirmed=NO;self.focusQueryInFlight=NO;self.everReady=NO;self.firstReadyMs=nil;self.installedMs=nil;
    self.sessionID=[NSUUID.UUID.UUIDString.lowercaseString substringToIndex:8];self.sourceAtStart=currentSourceFamily();
    self.startTime=NSProcessInfo.processInfo.systemUptime;self.deadline=self.startTime+3.0;self.active=YES;
    self.state=@"arming-focus";self.endState=@"none";self.capability=@"waiting-focus";
    __weak OIProbe *weak=self;
    self.monitor=[NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskFlagsChanged|NSEventMaskKeyDown|NSEventMaskKeyUp) handler:^NSEvent *(NSEvent *event){
        OIProbe *p=weak;
        if(p.active && targetWindow(event.window,p.webview.window,NSApp.keyWindow) && shiftEvent(event)) {
            if(p.ready && p.advanced && (!p.trackedContext || p.webview.inputContext!=p.trackedContext))[p advanceReadiness];
            [p record:[p nativeEvent:event source:@"app-local-monitor"]];
        }
        return event;
    }];
    [self record:@{@"source":@"session-start",@"advanced":@(advanced),@"inputSourceFamily":self.sourceAtStart}];
    if(self.featureInfo.count && ![self.featureInfo[@"status"] isEqual:@"readback-confirmed"]){[self failReadiness:@"feature-unavailable-or-mismatch"];return;}
    if(!self.monitor){[self failReadiness:@"local-monitor-unavailable"];return;}
    [self status];[self ensureTimer];[self requestFocusConfirmation];
}
- (void)stop {
    if(self.active)self.endState=self.state;
    self.active=NO;self.generation++;[self.readinessTimer invalidate];self.readinessTimer=nil;
    if(self.monitor){[NSEvent removeMonitor:self.monitor];self.monitor=nil;}
    [self detachHook];self.state=@"stopped";self.focusQueryInFlight=NO;[self status];
}
- (NSUInteger)pendingText {NSUInteger n=0;for(NSNumber *v in self.textCalls.allValues)if(v.unsignedIntegerValue==0)n++;return n;}
- (NSUInteger)pending {NSUInteger n=0;for(NSNumber *v in self.calls.allValues)if(v.unsignedIntegerValue==0)n++;return n;}
- (NSString *)outcome {
    if(!self.advanced)return @"baseline";
    NSString *state=self.active?self.state:self.endState;
    if(self.calls.count)return @"advanced-observed";
    if([state isEqual:@"ready-advanced"])return @"advanced-ready";
    return self.everReady?@"advanced-interrupted":@"advanced-not-ready";
}
- (NSString *)exportName {return [NSString stringWithFormat:@"sogou-real-ab-v5-%@-%@-%@-%@.json",self.featureInfo[@"requested"]?:@"unknown",self.label,[self outcome],self.sessionID];}
- (NSDictionary *)snapshot {
    NSBundle *wk=[NSBundle bundleForClass:WKWebView.class];
    return @{@"schema":@5,@"diagnostic":@"sogou-real-feature-ab-v5",@"feature":self.featureInfo,@"textClientCapabilities":self.textCapabilities,@"textCallbackCounts":self.textCalls,@"pendingTextCallbacks":@([self pendingText]),@"commit":@OI_COMMIT,@"htmlSHA256":@OI_HTML_SHA,
        @"host":self.host,@"bundleID":NSBundle.mainBundle.bundleIdentifier?:@"unknown",@"osVersion":NSProcessInfo.processInfo.operatingSystemVersionString,
        @"webKitBundleVersion":[wk objectForInfoDictionaryKey:@"CFBundleVersion"]?:@"unknown",@"tauriVersion":[self.host isEqual:@"tauri"]?@"2.12.4":@"not-used",@"wryVersion":[self.host isEqual:@"tauri"]?@"0.57.0":@"not-used",
        @"inputMethodManualLabel":self.label,@"inputSourceFamilyAtStart":self.sourceAtStart,@"inputSourceDetection":@"public-TIS-family-only",@"inputMethodInternalModeDetected":@NO,
        @"sessionID":self.sessionID,@"advancedRequested":@(self.advanced),@"inputContextProbe":self.capability,@"readinessState":self.state,@"stateAtStop":self.endState,
        @"outcome":[self outcome],@"everReady":@(self.everReady),@"installedNow":@(self.hookedClass!=Nil),@"contextChecks":@(self.contextChecks),@"firstReadyMs":self.firstReadyMs?:NSNull.null,@"lastInstalledMs":self.installedMs?:NSNull.null,
        @"observations":@{@"nativeShift":@"application-local-monitor",@"wkResponderEntry":@"not-instrumented",@"inputContextCompletion":self.capability,@"inputContextOffMainEntry":@"forwarded-unobserved",@"DOM":@"window-capture"},
        @"pendingCallbacks":@([self pending]),@"callbackCounts":self.calls,@"limit":@(Limit),@"dropped":@(self.dropped),@"active":@(self.active),
        @"clockNote":@"Native and page monotonic clocks have different origins. DOM/native correlation is temporal inference. Only ready rows are eligible; callback callEpoch identifies its original context interval. Shift flags are aggregate, not per-side release state.",@"rows":self.rows};
}
- (void)status {
    if(!self.webview)return;
    NSDictionary *s=@{@"active":@(self.active),@"ready":@(self.ready),@"state":self.state,@"count":@(self.rows.count),@"dropped":@(self.dropped),@"pending":@([self pending]),@"capability":self.capability,@"host":self.host,@"commit":@OI_COMMIT,@"sourceFamily":self.sourceAtStart,@"feature":self.featureInfo};
    NSData *data=[NSJSONSerialization dataWithJSONObject:s options:0 error:nil];NSString *json=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];
    [self.webview evaluateJavaScript:[NSString stringWithFormat:@"window.nativeStatus?.(%@)",json] completionHandler:nil];
}
- (void)export {
    [self stop];NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=[self exportName];
    [panel beginSheetModalForWindow:self.webview.window completionHandler:^(NSModalResponse response){
        if(response!=NSModalResponseOK)return;NSError *error=nil;NSData *data=[NSJSONSerialization dataWithJSONObject:[self snapshot] options:NSJSONWritingPrettyPrinted error:&error];
        if(data && [data writeToURL:panel.URL options:NSDataWritingAtomic error:&error])return;
        NSAlert *alert=[NSAlert new];alert.messageText=@"导出失败，请重新选择保存位置。";[alert beginSheetModalForWindow:self.webview.window completionHandler:nil];
    }];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if(!message.frameInfo.mainFrame || ![message.body isKindOfClass:NSDictionary.class])return;
    NSDictionary *b=message.body;id op=b[@"op"];
    if([op isEqual:@"mode"] && enumValue(b[@"mode"],@[@"default",@"off",@"on"])) {if(self.changeMode)self.changeMode(b[@"mode"]);return;}
    if([op isEqual:@"status"]){[self status];return;}
    if([op isEqual:@"start"]){[self start:b[@"label"] advanced:[b[@"advanced"] isEqual:@YES]];return;}
    if([op isEqual:@"focus"]){if([b[@"focused"] isKindOfClass:NSNumber.class])[self focusChanged:[b[@"focused"] boolValue]];return;}
    if([op isEqual:@"stop"]){[self stop];return;}
    if([op isEqual:@"export"]){[self export];return;}
    if([op isEqual:@"dom"]){NSDictionary *safe=safeDOM(b);if(safe)[self record:safe];}
    if([op isEqual:@"text-state"] && enumValue(b[@"type"],@[@"beforeinput",@"input",@"compositionstart",@"compositionupdate",@"compositionend"]))
        [self record:@{@"source":@"dom-text-length",@"type":b[@"type"],@"length":number(b[@"length"]),@"targetLength":number(b[@"targetLength"]),@"pageMs":number(b[@"pageMs"])}];
    [self status];
}
- (void)dealloc {[_readinessTimer invalidate];if(_monitor)[NSEvent removeMonitor:_monitor];if(_closeObserver)[NSNotificationCenter.defaultCenter removeObserver:_closeObserver];}
@end
static OIProbe *tauriProbe;
void oi_attach(void *webview) {tauriProbe=[[OIProbe alloc]initWithHost:@"tauri"];[tauriProbe attach:(__bridge WKWebView *)webview];}

#include "Smoke.h"
