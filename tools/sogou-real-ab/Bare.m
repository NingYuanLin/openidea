#import "shared/Probe.h"
#import "shared/TextObserver.h"
@interface WKPreferences (ABFeatures)
+ (NSArray *)_features;
- (BOOL)_isEnabledForFeature:(id)feature;
- (void)_setEnabled:(BOOL)enabled forFeature:(id)feature;
@end
@interface NSObject (ABFeatureKey)
- (NSString *)key;
@end
@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic,strong) NSWindow *window;
@property(nonatomic,strong) OIProbe *probe;
@property(nonatomic,strong) NSDictionary *capabilities;
@end
@implementation AppDelegate
- (void)loadMode:(NSString *)mode {
    OIProbe *previous=self.probe;[previous dispose];
    if([NSProcessInfo.processInfo.arguments containsObject:@"--diagnostic-self-test"] && previous){
        if(!previous.disposed){fprintf(stderr,"FAIL old probe cleanup incomplete\n");exit(29);}
        printf("PASS same-process mode switch disposed old observer; new WKWebView below\n");
    }
    self.probe=nil;
    WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=WKWebsiteDataStore.nonPersistentDataStore;
    NSMutableDictionary *feature=[@{@"name":@"InputMethodUsesCorrectKeyEventOrder",@"requested":mode,@"actual":NSNull.null,@"status":@"unsupported",@"defaultActual":NSNull.null} mutableCopy];
    id selected=nil;
    @try {
        if([WKPreferences respondsToSelector:@selector(_features)] && [config.preferences respondsToSelector:@selector(_isEnabledForFeature:)] && [config.preferences respondsToSelector:@selector(_setEnabled:forFeature:)]) {
            for(id f in [WKPreferences _features])if([f respondsToSelector:@selector(key)] && [[f key] isEqual:feature[@"name"]])selected=f;
            if(selected){
                feature[@"defaultActual"]=@([config.preferences _isEnabledForFeature:selected]);
                if(![mode isEqual:@"default"])[config.preferences _setEnabled:[mode isEqual:@"on"] forFeature:selected];
            }
        }
    } @catch(NSException *e){feature[@"status"]=@"feature-API-exception";selected=nil;}
    OIObservedWebView *view=[[OIObservedWebView alloc]initWithFrame:self.window.contentView.bounds configuration:config];
    if(selected) @try {
        BOOL actual=[view.configuration.preferences _isEnabledForFeature:selected];feature[@"actual"]=@(actual);
        feature[@"status"]=[mode isEqual:@"default"] || actual==[mode isEqual:@"on"]?@"readback-confirmed":@"readback-mismatch";
    } @catch(NSException *e){feature[@"status"]=@"readback-exception";}
    view.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.window.contentView=view;
    self.probe=[[OIProbe alloc]initWithHost:@"appkit-real-ime"];
    self.probe.featureInfo=feature;self.probe.textCapabilities=self.capabilities;view.probe=self.probe;
    __weak AppDelegate *weak=self;
    self.probe.changeMode=^(NSString *next){dispatch_async(dispatch_get_main_queue(),^{[weak loadMode:next];});};
    [self.probe attach:view];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.capabilities=OIInstallTextObservers();
    self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1000,960) styleMask:(NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable) backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"Sogou Real A/B v5 — 真实输入法开关对照";
    NSString *mode=[NSUserDefaults.standardUserDefaults stringForKey:@"mode"];
    if(![@[@"default",@"off",@"on"] containsObject:mode])mode=@"default";
    [self loadMode:mode];[self.window center];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {return YES;}
- (void)applicationWillTerminate:(NSNotification *)notification {[self.probe dispose];}
@end
int main(void){@autoreleasepool{NSApplication *app=NSApplication.sharedApplication;[app setActivationPolicy:NSApplicationActivationPolicyRegular];AppDelegate *delegate=[AppDelegate new];app.delegate=delegate;[app run];}return 0;}
