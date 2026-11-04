#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
@interface OIProbe : NSObject <WKScriptMessageHandler>
@property(nonatomic, weak) WKWebView *webview;
- (instancetype)initWithHost:(NSString *)host;
- (void)attach:(WKWebView *)webview;
- (void)stop;
- (void)dispose;
- (BOOL)disposed;
@property(nonatomic,copy) NSDictionary *featureInfo;
@property(nonatomic,copy) NSDictionary *textCapabilities;
@property(nonatomic,copy) void (^changeMode)(NSString *mode);
- (NSUInteger)beginTextCall:(NSString *)selector metadata:(NSDictionary *)metadata;
- (void)endTextCall:(NSUInteger)call metadata:(NSDictionary *)metadata;
- (NSUInteger)sessionGeneration;
@end
void oi_attach(void *webview);
