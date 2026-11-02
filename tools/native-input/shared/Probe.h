#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
@interface OIProbe : NSObject <WKScriptMessageHandler>
@property(nonatomic, weak) WKWebView *webview;
- (instancetype)initWithHost:(NSString *)host;
- (void)attach:(WKWebView *)webview;
- (void)stop;
@end
void oi_attach(void *webview);
