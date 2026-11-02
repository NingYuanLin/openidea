#import "Probe.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <math.h>
#ifndef OI_COMMIT
#define OI_COMMIT "development"
#endif
#ifndef OI_HTML_SHA
#define OI_HTML_SHA "development"
#endif
static const NSUInteger Limit = 6000;
static BOOL shiftEvent(NSEvent *e) { return e && (e.type == NSEventTypeFlagsChanged || e.type == NSEventTypeKeyDown || e.type == NSEventTypeKeyUp) && (e.keyCode == 56 || e.keyCode == 60); }
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
@interface OIProbe ()
@property(nonatomic) BOOL active;
@property(nonatomic) NSUInteger generation, dropped, nextEvent, nextCall;
@property(nonatomic) double startTime;
@property(nonatomic,strong) NSMutableArray *rows;
@property(nonatomic,strong) NSMutableDictionary *calls;
@property(nonatomic,strong) NSMapTable *eventIDs;
@property(nonatomic,strong) id monitor, closeObserver;
@property(nonatomic,copy) NSString *host, *label, *capability;
@property(nonatomic,weak) id trackedContext;
@property(nonatomic) Class hookedClass;
@property(nonatomic) IMP original;
@property(nonatomic) BOOL advanced;
- (void)record:(NSDictionary *)record;
- (NSDictionary *)nativeEvent:(NSEvent *)event source:(NSString *)source;
- (void)start:(NSString *)label advanced:(BOOL)advanced;
- (NSDictionary *)snapshot;
- (void)status;
@end
static void selfTest(OIProbe *probe);
static __weak OIProbe *activeProbe;
static NSMutableDictionary<NSValue *,NSValue *> *originals;
static SEL inputSelector(void) {return NSSelectorFromString(@"handleEventByInputMethod:completionHandler:");}
typedef void (*InputIMP)(id, SEL, NSEvent *, void (^)(BOOL));
// No second invocation, synchronous wait, synthetic callback, or callback suppression.
static void observeInput(id self, SEL cmd, NSEvent *event, void (^completion)(BOOL)) {
 Class cls=object_getClass(self); IMP imp=NULL;
 @synchronized(OIProbe.class){for(Class c=cls;c && !imp;c=class_getSuperclass(c))imp=[originals[[NSValue valueWithPointer:(__bridge const void *)c]] pointerValue];}
 if(!NSThread.isMainThread){((InputIMP)imp)(self,cmd,event,completion);return;}
 OIProbe *p=activeProbe;
 if(!p.active || self!=p.trackedContext || !shiftEvent(event) || !NSThread.isMainThread) { ((InputIMP)imp)(self,cmd,event,completion); return; }
 p.capability=@"installed-observed-entry";
 NSUInteger generation=p.generation, call=++p.nextCall; NSString *callKey=[NSString stringWithFormat:@"%lu",(unsigned long)call];
 p.calls[callKey]=@0;
 NSMutableDictionary *entry=[[p nativeEvent:event source:@"input-context-enter"] mutableCopy];entry[@"call"]=@(call);[p record:entry];
 __weak OIProbe *weak=p;
 void (^forward)(BOOL)=completion ? ^(BOOL handled) {
   double when=NSProcessInfo.processInfo.systemUptime; BOOL main=NSThread.isMainThread;
   void (^log)(void)=^{OIProbe *s=weak;if(s.active && s.generation==generation){s.calls[callKey]=@([s.calls[callKey] unsignedIntegerValue]+1);[s record:@{@"source":@"input-context-completion",@"call":@(call),@"handled":@(handled),@"callbackUptimeMs":@(when*1000),@"callbackThread":main?@"main":@"other"}];}};
   if(main)log();else dispatch_async(dispatch_get_main_queue(),log);
   completion(handled);
 } : nil;
 ((InputIMP)imp)(self,cmd,event,forward);
}
static BOOL supportedMethod(Method m) {
 if(!m || method_getNumberOfArguments(m)!=4)return NO;
 char ret[32]={0}, event[32]={0}, block[32]={0};method_getReturnType(m,ret,32);method_getArgumentType(m,2,event,32);method_getArgumentType(m,3,block,32);
 return !strcmp(ret,"v") && event[0]=='@' && !strcmp(block,"@?");
}
@implementation OIProbe
- (instancetype)initWithHost:(NSString *)host {
 if((self=[super init])){_host=host;_rows=[NSMutableArray array];_calls=[NSMutableDictionary dictionary];_capability=@"disabled";_label=@"unspecified";_eventIDs=[NSMapTable mapTableWithKeyOptions:NSPointerFunctionsWeakMemory|NSPointerFunctionsObjectPointerPersonality valueOptions:NSPointerFunctionsStrongMemory];}return self;
}
- (void)attach:(WKWebView *)webview {
 self.webview=webview;[webview.configuration.userContentController addScriptMessageHandler:self name:@"nativeDiagnostic"];
 __weak OIProbe *weak=self;
 self.closeObserver=[NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification object:webview.window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *n){[weak stop];}];
 NSURL *html=[NSBundle.mainBundle URLForResource:@"index" withExtension:@"html"];
 NSString *content=[NSString stringWithContentsOfURL:html encoding:NSUTF8StringEncoding error:nil];
 [webview loadHTMLString:content?:@"<h1>Missing diagnostic page</h1>" baseURL:nil];
 if([NSProcessInfo.processInfo.arguments containsObject:@"--diagnostic-self-test"])selfTest(self);
}
- (void)record:(NSDictionary *)record {
 if(!self.active)return;
 if(self.rows.count>=Limit){self.dropped++;[self stop];return;}
 NSMutableDictionary *r=[record mutableCopy];r[@"seq"]=@(self.rows.count);r[@"nativeReceiveMs"]=@((NSProcessInfo.processInfo.systemUptime-self.startTime)*1000);[self.rows addObject:r];
}
- (NSDictionary *)nativeEvent:(NSEvent *)e source:(NSString *)source {
 NSNumber *identity=[self.eventIDs objectForKey:e];if(!identity){identity=@(++self.nextEvent);[self.eventIDs setObject:identity forKey:e];}
 NSEventModifierFlags f=e.modifierFlags;
 id responder=self.webview.window.firstResponder;
 NSString *kind=responder==self.webview?@"webview":[responder isKindOfClass:NSTextView.class]?@"text-view":@"other";
 return @{@"source":source,@"eventID":identity,@"eventUptimeMs":@(e.timestamp*1000),@"type":eventType(e),@"nativeKeyCode":@(e.keyCode),@"shift":@((f&NSEventModifierFlagShift)!=0),@"ctrl":@((f&NSEventModifierFlagControl)!=0),@"alt":@((f&NSEventModifierFlagOption)!=0),@"meta":@((f&NSEventModifierFlagCommand)!=0),@"firstResponder":kind,@"keyWindow":@(self.webview.window.isKeyWindow)};
}
- (void)installHook {
 id context=self.webview.inputContext;
 if(!context){self.capability=@"unavailable-no-input-context";return;}
 Class cls=object_getClass(context);SEL sel=inputSelector();Method m=class_getInstanceMethod(cls,sel);
 if(!supportedMethod(m)){self.capability=@"unavailable-selector-or-ABI";return;}
 IMP original=method_getImplementation(m);
 if(original==(IMP)observeInput){self.capability=@"unavailable-already-wrapped";return;}
 // Add an own method before replacement: never replace an inherited superclass slot.
 class_addMethod(cls,sel,original,method_getTypeEncoding(m));
 Method own=NULL;unsigned int count=0;Method *methods=class_copyMethodList(cls,&count);
 for(unsigned int i=0;i<count;i++)if(method_getName(methods[i])==sel)own=methods[i];free(methods);
 if(!own){self.capability=@"unavailable-own-method-slot";return;}
 @synchronized(OIProbe.class){if(!originals)originals=[NSMutableDictionary dictionary];
 originals[[NSValue valueWithPointer:(__bridge const void *)cls]]=[NSValue valueWithPointer:original];}
 self.trackedContext=context;self.hookedClass=cls;self.original=original;activeProbe=self;
 method_setImplementation(own,(IMP)observeInput);self.capability=@"installed-awaiting-observation";
}
- (void)start:(NSString *)label advanced:(BOOL)advanced {
 [self stop];self.generation++;self.rows=[NSMutableArray array];self.calls=[NSMutableDictionary dictionary];[self.eventIDs removeAllObjects];self.nextEvent=0;self.nextCall=0;self.dropped=0;self.label=label;self.advanced=advanced;self.startTime=NSProcessInfo.processInfo.systemUptime;self.active=YES;self.capability=@"disabled";
 if(advanced)[self installHook];
 __weak OIProbe *weak=self;
 self.monitor=[NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskFlagsChanged|NSEventMaskKeyDown|NSEventMaskKeyUp) handler:^NSEvent *(NSEvent *event){OIProbe *p=weak;if(p.active && event.window==p.webview.window && shiftEvent(event))[p record:[p nativeEvent:event source:@"app-local-monitor"]];return event;}];
 if(!self.monitor)self.capability=@"local-monitor-unavailable";
 [self record:@{@"source":@"session-start",@"advanced":@(advanced)}];[self status];
}
- (void)stop {
 self.active=NO;
 if(self.monitor){[NSEvent removeMonitor:self.monitor];self.monitor=nil;}
 if(self.hookedClass){Method m=class_getInstanceMethod(self.hookedClass,inputSelector());if(method_getImplementation(m)==(IMP)observeInput)method_setImplementation(m,self.original);else self.capability=@"restore-conflict";self.hookedClass=Nil;}
 if(activeProbe==self)activeProbe=nil;self.trackedContext=nil;
 [self status];
}
- (NSUInteger)pending {NSUInteger n=0;for(NSNumber *v in self.calls.allValues)if(v.unsignedIntegerValue==0)n++;return n;}
- (NSDictionary *)snapshot {
 NSBundle *wk=[NSBundle bundleForClass:WKWebView.class];
 return @{@"schema":@3,@"diagnostic":@"native-shift-host-comparison-v3",@"commit":@OI_COMMIT,@"htmlSHA256":@OI_HTML_SHA,@"host":self.host,@"bundleID":NSBundle.mainBundle.bundleIdentifier?:@"unknown",@"osVersion":NSProcessInfo.processInfo.operatingSystemVersionString,@"webKitBundleVersion":[wk objectForInfoDictionaryKey:@"CFBundleVersion"]?:@"unknown",@"tauriVersion":[self.host isEqual:@"tauri"]?@"2.12.4":@"not-used",@"wryVersion":[self.host isEqual:@"tauri"]?@"0.57.0":@"not-used",@"inputMethodManualLabel":self.label,@"inputMethodAutomaticallyDetected":@NO,@"advancedRequested":@(self.advanced),@"inputContextProbe":self.capability,@"observations":@{@"nativeShift":@"application-local-monitor",@"wkResponderEntry":@"not-instrumented",@"inputContextCompletion":self.capability,@"inputContextOffMainEntry":@"forwarded-unobserved",@"DOM":@"window-capture"},@"pendingCallbacks":@([self pending]),@"callbackCounts":self.calls,@"limit":@(Limit),@"dropped":@(self.dropped),@"active":@(self.active),@"clockNote":@"nativeReceiveMs is relative native uptime; eventUptimeMs/callbackUptimeMs are absolute monotonic uptime; pageMs is a separate clock. DOM/native correlation is temporal inference, not object identity. Shift flags are aggregate, not per-side release state.",@"rows":self.rows};
}
- (void)status {
 if(!self.webview)return;
 NSDictionary *s=@{@"active":@(self.active),@"count":@(self.rows.count),@"dropped":@(self.dropped),@"pending":@([self pending]),@"capability":self.capability,@"host":self.host,@"commit":@OI_COMMIT};
 NSData *data=[NSJSONSerialization dataWithJSONObject:s options:0 error:nil];NSString *json=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];
 [self.webview evaluateJavaScript:[NSString stringWithFormat:@"window.nativeStatus?.(%@)",json] completionHandler:nil];
}
- (void)export {
 [self stop];NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=[NSString stringWithFormat:@"native-shift-v3-%@-%@.json",self.host,self.label];
 [panel beginSheetModalForWindow:self.webview.window completionHandler:^(NSModalResponse response){if(response!=NSModalResponseOK)return;NSError *error=nil;NSData *data=[NSJSONSerialization dataWithJSONObject:[self snapshot] options:NSJSONWritingPrettyPrinted error:&error];if(data && [data writeToURL:panel.URL options:NSDataWritingAtomic error:&error])return;NSAlert *alert=[NSAlert new];alert.messageText=@"导出失败，请重新选择保存位置。";[alert beginSheetModalForWindow:self.webview.window completionHandler:nil];}];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
 if(!message.frameInfo.mainFrame || ![message.body isKindOfClass:NSDictionary.class])return;
 NSDictionary *b=message.body;id op=b[@"op"];
 if([op isEqual:@"status"]){[self status];return;}
 if([op isEqual:@"start"]){if(enumValue(b[@"label"],@[@"abc",@"builtin-chinese",@"sogou-chinese",@"sogou-english"]))[self start:b[@"label"] advanced:[b[@"advanced"] isEqual:@YES]];return;}
 if([op isEqual:@"stop"]){[self stop];return;}
 if([op isEqual:@"export"]){[self export];return;}
 if([op isEqual:@"dom"]){NSDictionary *safe=safeDOM(b);if(safe)[self record:safe];}
 if([op isEqual:@"text-state"] && enumValue(b[@"type"],@[@"beforeinput",@"input",@"compositionstart",@"compositionupdate",@"compositionend"]))[self record:@{@"source":@"dom-text-length",@"type":b[@"type"],@"length":number(b[@"length"]),@"targetLength":number(b[@"targetLength"]),@"pageMs":number(b[@"pageMs"])}];
 [self status];
}
- (void)dealloc {if(_monitor)[NSEvent removeMonitor:_monitor];if(_closeObserver)[NSNotificationCenter.defaultCenter removeObserver:_closeObserver];}
@end
static OIProbe *tauriProbe;
void oi_attach(void *webview) {tauriProbe=[[OIProbe alloc]initWithHost:@"tauri"];[tauriProbe attach:(__bridge WKWebView *)webview];}

// Explicit CLI-only CI smoke; never runs during ordinary launch or writes a report.
static void selfTest(OIProbe *probe) {
 __weak OIProbe *weak=probe;
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC),dispatch_get_main_queue(),^{
 OIProbe *p=weak;
 [p.webview evaluateJavaScript:@"document.getElementById('start').click(); document.activeElement.id" completionHandler:^(id result,NSError *error){
 if(error || ![result isEqual:@"sample"]){fprintf(stderr,"FAIL native smoke page/focus\n");exit(11);}
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{
 if(!p.active || p.advanced){fprintf(stderr,"FAIL native smoke default public capture\n");exit(12);}
 NSEvent *event=[NSEvent keyEventWithType:NSEventTypeFlagsChanged location:NSZeroPoint modifierFlags:NSEventModifierFlagShift timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:p.webview.window.windowNumber context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:56];
 [NSApp postEvent:event atStart:NO];
 [p.webview evaluateJavaScript:@"document.getElementById('sample').dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',code:'ShiftLeft',keyCode:16,bubbles:true}));document.getElementById('sample').dispatchEvent(new KeyboardEvent('keydown',{key:'SECRET_SENTINEL',code:'KeyA',keyCode:65,bubbles:true}));" completionHandler:nil];
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{
 BOOL native=NO,dom=NO;for(NSDictionary *row in p.rows){native|=[row[@"source"] isEqual:@"app-local-monitor"];dom|=[row[@"source"] isEqual:@"dom-window-capture"];}
 if(!native || !dom){fprintf(stderr,"FAIL native smoke flagsChanged/DOM coverage\n");exit(13);}
 [p export];
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{
 NSWindow *sheet=p.webview.window.attachedSheet;if(!sheet){fprintf(stderr,"FAIL native smoke export sheet\n");exit(14);}
 [NSApp endSheet:sheet returnCode:NSModalResponseCancel];
 if(p.active || p.monitor){fprintf(stderr,"FAIL native smoke export did not stop\n");exit(15);}
 NSString *text=[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:[p snapshot] options:0 error:nil] encoding:NSUTF8StringEncoding];
 if([text containsString:@"SECRET_SENTINEL"]){fprintf(stderr,"FAIL native smoke privacy\n");exit(16);}
 [p start:@"abc" advanced:NO];[p.webview.window performClose:nil];
 if(p.active){fprintf(stderr,"FAIL native smoke close cleanup\n");exit(17);}
 printf("PASS packaged host page/focus/default-off/private-off/native-flagsChanged/DOM/redaction/export-cancel/restart/close; synthetic only\n");fflush(stdout);exit(0);
 });});});}];});
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,25*NSEC_PER_SEC),dispatch_get_main_queue(),^{fprintf(stderr,"FAIL native smoke timeout\n");exit(18);});
}
