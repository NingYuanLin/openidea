#import "TextObserver.h"
#import <objc/runtime.h>
@implementation OIObservedWebView
@end
// Only inherited selectors with matching ABI get an override. No extra selectors
// are advertised to IMEs; unsupported methods remain absent. Original IMPs are
// called with the original receiver, selector and arguments exactly once.
static NSMutableDictionary *implementations;
static IMP original(SEL cmd) {return [implementations[NSStringFromSelector(cmd)] pointerValue];}
static NSDictionary *rangeInfo(NSRange r) {return @{@"notFound":@(r.location==NSNotFound),@"length":@(r.length)};}
static NSDictionary *textInfo(id text) {
    if([text isKindOfClass:NSString.class])return @{@"textKind":@"string",@"textLength":@([text length])};
    if([text isKindOfClass:NSAttributedString.class])return @{@"textKind":@"attributed",@"textLength":@([text length])};
    return @{@"textKind":@"other",@"textLength":NSNull.null};
}
static NSUInteger begin(id receiver, SEL cmd, NSDictionary *metadata) {
    return [[receiver probe] beginTextCall:NSStringFromSelector(cmd) metadata:metadata];
}
static void end(OIProbe *p, NSUInteger generation, NSUInteger call, NSDictionary *meta) {
    BOOL main=NSThread.isMainThread;double time=NSProcessInfo.processInfo.systemUptime*1000;
    void (^log)(void)=^{if(p.sessionGeneration==generation){NSMutableDictionary *r=[meta mutableCopy];r[@"callbackThread"]=main?@"main":@"other";r[@"callbackUptimeMs"]=@(time);[p endTextCall:call metadata:r];}};
    if(main)log();else dispatch_async(dispatch_get_main_queue(),log);
}
static void insert(id obj,SEL cmd,id text) {
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,textInfo(text));
    ((void(*)(id,SEL,id))original(cmd))(obj,cmd,text);end(p,gen,call,@{});
}
static void insertRange(id obj,SEL cmd,id text,NSRange range) {
    NSMutableDictionary *m=[textInfo(text) mutableCopy];m[@"replacementRange"]=rangeInfo(range);
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,m);
    ((void(*)(id,SEL,id,NSRange))original(cmd))(obj,cmd,text,range);end(p,gen,call,@{});
}
static void marked(id obj,SEL cmd,id text,NSRange selected,NSRange replacement) {
    NSMutableDictionary *m=[textInfo(text) mutableCopy];m[@"selectedRange"]=rangeInfo(selected);m[@"replacementRange"]=rangeInfo(replacement);
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,m);
    ((void(*)(id,SEL,id,NSRange,NSRange))original(cmd))(obj,cmd,text,selected,replacement);end(p,gen,call,@{});
}
static void unmark(id obj,SEL cmd) {
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,@{});
    ((void(*)(id,SEL))original(cmd))(obj,cmd);end(p,gen,call,@{});
}
static BOOL boolState(id obj,SEL cmd) {
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,@{});
    BOOL value=((BOOL(*)(id,SEL))original(cmd))(obj,cmd);end(p,gen,call,@{@"value":@(value)});return value;
}
static NSRange rangeState(id obj,SEL cmd) {
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,@{});
    NSRange value=((NSRange(*)(id,SEL))original(cmd))(obj,cmd);end(p,gen,call,@{@"range":rangeInfo(value)});return value;
}
static void boolAsync(id obj,SEL cmd,void(^callback)(BOOL)) {
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,@{@"callbackProvided":@(callback!=nil)});
    if(!call){((void(*)(id,SEL,void(^)(BOOL)))original(cmd))(obj,cmd,callback);return;}
    // Do not introduce a callback if the original caller provided none.
    void(^wrapped)(BOOL)=callback?^(BOOL value){end(p,gen,call,@{@"value":@(value)});callback(value);}:nil;
    ((void(*)(id,SEL,void(^)(BOOL)))original(cmd))(obj,cmd,wrapped);
}
static void rangeAsync(id obj,SEL cmd,void(^callback)(NSRange)) {
    OIProbe *p=[obj probe];NSUInteger gen=p.sessionGeneration,call=begin(obj,cmd,@{@"callbackProvided":@(callback!=nil)});
    if(!call){((void(*)(id,SEL,void(^)(NSRange)))original(cmd))(obj,cmd,callback);return;}
    void(^wrapped)(NSRange)=callback?^(NSRange value){end(p,gen,call,@{@"range":rangeInfo(value)});callback(value);}:nil;
    ((void(*)(id,SEL,void(^)(NSRange)))original(cmd))(obj,cmd,wrapped);
}
// Compiler-provided encodings avoid guessing NSRange/BOOL ABI on the host SDK.
@interface OIEncoding : NSObject
- (void)insertText:(id)t;
- (void)insertText:(id)t replacementRange:(NSRange)r;
- (void)setMarkedText:(id)t selectedRange:(NSRange)s replacementRange:(NSRange)r;
- (void)unmarkText;
- (BOOL)hasMarkedText;
- (NSRange)selectedRange;
- (NSRange)markedRange;
- (void)hasMarkedTextWithCompletionHandler:(void(^)(BOOL))c;
- (void)selectedRangeWithCompletionHandler:(void(^)(NSRange))c;
- (void)markedRangeWithCompletionHandler:(void(^)(NSRange))c;
@end
@implementation OIEncoding
- (void)insertText:(id)t {}
- (void)insertText:(id)t replacementRange:(NSRange)r {}
- (void)setMarkedText:(id)t selectedRange:(NSRange)s replacementRange:(NSRange)r {}
- (void)unmarkText {}
- (BOOL)hasMarkedText {return NO;}
- (NSRange)selectedRange {return NSMakeRange(NSNotFound,0);}
- (NSRange)markedRange {return NSMakeRange(NSNotFound,0);}
- (void)hasMarkedTextWithCompletionHandler:(void(^)(BOOL))c {}
- (void)selectedRangeWithCompletionHandler:(void(^)(NSRange))c {}
- (void)markedRangeWithCompletionHandler:(void(^)(NSRange))c {}
@end
static BOOL sameABI(Method a,Method b) {
    if(!a||!b||method_getNumberOfArguments(a)!=method_getNumberOfArguments(b))return NO;
    char *x=method_copyReturnType(a),*y=method_copyReturnType(b);BOOL same=!strcmp(x,y);free(x);free(y);
    for(unsigned i=0;same&&i<method_getNumberOfArguments(a);i++){x=method_copyArgumentType(a,i);y=method_copyArgumentType(b,i);same=!strcmp(x,y);free(x);free(y);}return same;
}
NSDictionary *OIInstallTextObservers(void) {
    static NSDictionary *result;static dispatch_once_t once;
    dispatch_once(&once,^{
        implementations=[NSMutableDictionary dictionary];NSMutableDictionary *cap=[NSMutableDictionary dictionary];
        NSArray *names=@[@"insertText:",@"insertText:replacementRange:",@"setMarkedText:selectedRange:replacementRange:",@"unmarkText",@"hasMarkedText",@"selectedRange",@"markedRange",@"hasMarkedTextWithCompletionHandler:",@"selectedRangeWithCompletionHandler:",@"markedRangeWithCompletionHandler:"];
        IMP wrappers[]={(IMP)insert,(IMP)insertRange,(IMP)marked,(IMP)unmark,(IMP)boolState,(IMP)rangeState,(IMP)rangeState,(IMP)boolAsync,(IMP)rangeAsync,(IMP)rangeAsync};
        for(NSUInteger i=0;i<names.count;i++) {
            SEL sel=NSSelectorFromString(names[i]);Method m=class_getInstanceMethod(WKWebView.class,sel),expected=class_getInstanceMethod(OIEncoding.class,sel);
            if(!sameABI(m,expected)){cap[names[i]]=@"unsupported-selector-or-ABI";continue;}
            implementations[names[i]]=[NSValue valueWithPointer:method_getImplementation(m)];
            cap[names[i]]=class_addMethod(OIObservedWebView.class,sel,wrappers[i],method_getTypeEncoding(m))?@"available-passive-when-enabled":@"installation-conflict";
        }result=[cap copy];
    });return result;
}
