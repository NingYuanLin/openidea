// Regression harness, built separately; never linked into either delivered app.
#import "shared/Probe.m"
@interface FakeContext : NSObject
@property int calls, mode;
@property(copy) void (^pending)(BOOL);
@end
@implementation FakeContext
- (void)handleEventByInputMethod:(NSEvent *)e completionHandler:(void (^)(BOOL))completion {
 self.calls++;
 if(self.mode==0)completion(YES);
 if(self.mode==1)self.pending=completion;
 if(self.mode==2){} // Legitimately never calls completion.
 if(self.mode==3){completion(NO);completion(YES);}
 if(self.mode==4)@throw [NSException exceptionWithName:@"SyntheticOriginalException" reason:nil userInfo:nil];
}
@end
@interface ChildContext : FakeContext @end
@implementation ChildContext @end
@interface FakeView : NSObject
@property(strong) id inputContext;
@property(strong) NSWindow *window;
@property BOOL focused, holdFocus;
@property(copy) void (^pendingFocus)(id,NSError *);
- (void)evaluateJavaScript:(id)script completionHandler:(id)handler;
@end
@implementation FakeView
- (void)evaluateJavaScript:(id)script completionHandler:(id)handler {
 if(handler){void (^callback)(id,NSError *)=handler;if(self.holdFocus)self.pendingFocus=callback;else callback(@(self.focused),nil);}
}
@end
static void check(BOOL pass, const char *name) {if(!pass){fprintf(stderr,"FAIL %s\n",name);exit(1);}printf("PASS %s\n",name);}
int main(void){@autoreleasepool{
 [NSApplication sharedApplication];
 check(supportedMethod(class_getInstanceMethod(FakeContext.class,inputSelector())),"exact void/block ABI");
 check(!supportedMethod(class_getInstanceMethod(NSObject.class,@selector(description))),"unsupported selector ABI rejected");
 NSWindow *one=(id)[NSObject new], *two=(id)[NSObject new];
 check(targetWindow(one,one,two),"window scope: own event accepted");
 check(!targetWindow(two,one,one),"window scope: other window excluded");
 check(targetWindow(nil,one,one),"window scope: windowless modifier accepted for active test window");
 check(!targetWindow(nil,one,two) && !targetWindow(nil,one,nil) && !targetWindow(nil,nil,nil),"window scope: inactive or disposed test window excluded");
 NSString *secret=@"SECRET_SENTINEL_abcdefghijklmnopqrstuvwxyz_938475";
 NSDictionary *safe=safeDOM(@{@"type":@"keydown",@"code":@"ShiftLeft",@"keyCode":@65,@"prototypeCode":@66,@"key":secret,@"which":@67,@"text":secret,@"length":secret,@"pageMs":secret});
 NSString *serialized=[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:safe options:0 error:nil] encoding:NSUTF8StringEncoding];
 check(![serialized containsString:secret] && [safe[@"keyCode"] isEqual:NSNull.null] && [safe[@"prototypeCode"] isEqual:NSNull.null] && !safe[@"which"],"privacy: text and printable numeric identifiers never buffered");
 check(!safeDOM(@{@"type":@"keydown",@"code":@"KeyA"}),"privacy: printable physical key rejected");
 NSEvent *shift=[NSEvent keyEventWithType:NSEventTypeFlagsChanged location:NSZeroPoint modifierFlags:NSEventModifierFlagShift timestamp:1 windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:56];
 NSEvent *letter=[NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:2 windowNumber:0 context:nil characters:secret charactersIgnoringModifiers:secret isARepeat:NO keyCode:0];
 check(shiftEvent(shift)&&!shiftEvent(letter),"flagsChanged covered; printable native event filtered");
 OIProbe *p=[[OIProbe alloc]initWithHost:@"appkit"];FakeView *view=[FakeView new];ChildContext *context=[ChildContext new];view.inputContext=context;view.focused=YES;p.webview=(id)view;
 IMP inherited=method_getImplementation(class_getInstanceMethod(FakeContext.class,inputSelector()));
 [p record:@{@"secret":secret}];check(p.rows.count==0,"default disabled");
 [p start:@"abc" advanced:NO];check(p.hookedClass==Nil,"public baseline has no private hook");[p stop];
 [p start:@"" advanced:YES];check(!p.active&&!p.hookedClass,"empty input-method label rejected");
 check([sourceFamily(@"com.apple.keylayout.ABC",nil) isEqual:@"abc"] && [sourceFamily(@"com.apple.inputmethod.SCIM.ITABC",nil) isEqual:@"builtin-chinese"] && [sourceFamily(@"com.sogou.inputmethod.sogou",nil) isEqual:@"sogou"],"public input-source categories mapped");
 check([sourceFamily(secret,secret) isEqual:@"unknown"],"custom input-source identifiers redacted");
 view.inputContext=nil;[p start:@"sogou-chinese" advanced:YES];
 check(p.active&&!p.ready&&!p.hookedClass&&[p.state isEqual:@"arming-context"],"cold context nil stays preparing, never ready");
 [p record:[p nativeEvent:shift source:@"pre-ready-test"]];check(![p.rows.lastObject[@"sampleEligible"] boolValue],"early Shift explicitly ineligible");
 view.inputContext=context;
 NSDate *readyDeadline=[NSDate dateWithTimeIntervalSinceNow:1];while(!p.ready&&[readyDeadline timeIntervalSinceNow]>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
 check(p.ready&&p.hookedClass&&p.contextChecks>=2,"timer advances nil to available without another Start");[p stop];
 view.inputContext=nil;[p start:@"abc" advanced:YES];p.deadline=NSProcessInfo.processInfo.systemUptime-1;[p advanceReadiness];
 check([p.state isEqual:@"failed"]&&[p.capability isEqual:@"timeout-input-context"]&&!p.ready&&!p.readinessTimer,"nil context timeout is explicit failure");
 check([[p exportName] containsString:@"advanced-not-ready"],"failed filename marks actual unavailable state");[p stop];
 [p start:@"abc" advanced:YES];[p stop];view.inputContext=context;
 [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.12]];[p advanceReadiness];
 check(!p.hookedClass&&!p.active&&!p.readinessTimer,"stopped delayed readiness cannot install");
 view.focused=NO;[p start:@"abc" advanced:YES];p.deadline=NSProcessInfo.processInfo.systemUptime-1;[p advanceReadiness];
 check([p.capability isEqual:@"timeout-focus"]&&!p.hookedClass,"focus timeout never installs");[p stop];view.focused=YES;
 view.holdFocus=YES;[p start:@"abc" advanced:YES];void (^oldFocus)(id,NSError *)=view.pendingFocus;[p stop];view.holdFocus=NO;
 [p start:@"abc" advanced:NO];oldFocus(@YES,nil);check(p.ready&&!p.hookedClass&&!p.advanced,"late focus acknowledgement isolated from next run");[p stop];
 [p start:@"abc" advanced:YES];NSUInteger oldEpoch=p.epoch;ChildContext *replacement=[ChildContext new];view.inputContext=replacement;[p advanceReadiness];
 check(!p.ready&&!p.hookedClass,"context replacement invalidates ready interval");[p advanceReadiness];
 check(p.ready&&p.trackedContext==replacement&&p.epoch>oldEpoch,"replacement context rearmed in new epoch");
 view.focused=NO;[p focusChanged:NO];check(!p.ready&&!p.hookedClass,"focus loss removes advanced hook");view.focused=YES;[p focusChanged:YES];check(p.ready&&p.hookedClass,"focus return rearms without hidden event dispatch");[p stop];view.inputContext=context;
 [p start:@"sogou-chinese" advanced:YES];check(p.hookedClass==ChildContext.class,"actual instance class hook installed");
 check(method_getImplementation(class_getInstanceMethod(FakeContext.class,inputSelector()))==inherited,"inherited superclass IMP untouched");
 __block int forwarded=0;
 [context handleEventByInputMethod:shift completionHandler:^(BOOL yes){check(yes,"synchronous handled preserved");forwarded++;}];
 check(context.calls==1&&forwarded==1&&[p pending]==0,"original and synchronous callback exactly once");
 context.mode=1;[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){forwarded++;}];check([p pending]==1,"delayed callback pending not false");context.pending(NO);context.pending=nil;check(forwarded==2&&[p pending]==0,"delayed callback forwarded");
 context.mode=1;__block BOOL callbackOnOriginalThread=NO;__block BOOL callbackDone=NO;
 [context handleEventByInputMethod:shift completionHandler:^(BOOL yes){callbackOnOriginalThread=!NSThread.isMainThread;callbackDone=YES;}];
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0),^{context.pending(YES);});
 NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:2];while(!callbackDone && [deadline timeIntervalSinceNow]>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
 [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
 context.pending=nil;check(callbackDone&&callbackOnOriginalThread&&[p pending]==0,"background callback forwarded on original thread");
 context.mode=2;[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){forwarded++;}];check(forwarded==2&&[p pending]==1,"absent callback not invented");
 context.mode=3;[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){forwarded++;}];check(forwarded==4,"original duplicate callbacks are not suppressed");
 NSUInteger before=p.rows.count;[context handleEventByInputMethod:letter completionHandler:^(BOOL yes){}];check(p.rows.count==before,"printable callback path untouched and unrecorded");
 context.mode=1;[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){forwarded++;}];[p stop];before=p.rows.count;context.pending(YES);context.pending=nil;check(forwarded==5&&p.rows.count==before,"late completion after stop forwards without logging");
 check(method_getImplementation(class_getInstanceMethod(ChildContext.class,inputSelector()))==inherited,"stop restores original IMP");
 [p start:@"abc" advanced:YES];context.mode=1;__block int crossed=0;
 [context handleEventByInputMethod:shift completionHandler:^(BOOL yes){crossed++;}];void (^late)(BOOL)=context.pending;
 [p start:@"abc" advanced:YES];late(YES);check(crossed==1&&p.calls.count==0,"prior-run callback forwarded but never attached to new run");context.pending=nil;
 context.mode=1;[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){crossed++;}];late=context.pending;
 view.inputContext=replacement;[p advanceReadiness];[p advanceReadiness];late(NO);
 check(crossed==2&&[p pending]==0&&![p.rows.lastObject[@"sameReadyEpoch"] boolValue],"context-change callback remains associated with old call epoch");context.pending=nil;[p stop];view.inputContext=context;
 [p start:@"abc" advanced:YES];context.mode=4;BOOL threw=NO;@try{[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){}];}@catch(NSException *e){threw=[e.name isEqual:@"SyntheticOriginalException"];}
 check(threw,"original exception is propagated unchanged");[p stop];

 [p start:@"abc" advanced:YES];[p stop];[p start:@"abc" advanced:YES];context.mode=0;[context handleEventByInputMethod:shift completionHandler:^(BOOL yes){forwarded++;}];check(forwarded==6,"repeated activation and teardown");
 for(NSUInteger i=0;i<Limit+20;i++)[p record:@{@"source":@"limit-test"}];check(p.rows.count==Limit&&!p.active&&p.dropped==1,"bounded buffer stops and unhooks");
 NSString *json=[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:[p snapshot] options:0 error:nil] encoding:NSUTF8StringEncoding];check(![json containsString:secret],"export contains no secret sentinel");
 [p stop];printf("Native harness complete. Synthetic events; NOT native Sogou verification.\n");
}return 0;}
