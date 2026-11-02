#import "shared/Probe.h"
@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic,strong) NSWindow *window;
@property(nonatomic,strong) OIProbe *probe;
@end
@implementation AppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,940,760) styleMask:(NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable) backing:NSBackingStoreBuffered defer:NO];
 self.window.title=@"Shift Native v4 — 裸 AppKit WKWebView";
 WKWebView *webview=[[WKWebView alloc]initWithFrame:self.window.contentView.bounds configuration:[WKWebViewConfiguration new]];
 webview.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.window.contentView=webview;
 self.probe=[[OIProbe alloc]initWithHost:@"appkit"];[self.probe attach:webview];
 [self.window center];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {return YES;}
- (void)applicationWillTerminate:(NSNotification *)notification {[self.probe stop];}
@end
int main(void) {@autoreleasepool{NSApplication *app=NSApplication.sharedApplication;[app setActivationPolicy:NSApplicationActivationPolicyRegular];AppDelegate *delegate=[AppDelegate new];app.delegate=delegate;[app run];}return 0;}
