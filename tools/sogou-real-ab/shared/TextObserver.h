#import "Probe.h"
@interface OIObservedWebView : WKWebView
@property(nonatomic,weak) OIProbe *probe;
@end
NSDictionary *OIInstallTextObservers(void);
