#import <UIKit/UIKit.h>

static UIButton *g_floatBtn;

static void showMenu() {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"快捷链接" message:nil preferredStyle:UIAlertControllerStyleActionSheet];

    [alert addAction:[UIAlertAction actionWithTitle:@"百度" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://www.baidu.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"B站" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://bilibili.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"GitHub" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://github.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"取消" style:UIAlertActionStyleCancel handler:nil]];

    UIViewController *topVC = nil;
    for (UIWindow *win in [UIApplication sharedApplication].windows) {
        if (win.isKeyWindow) {
            topVC = win.rootViewController;
            break;
        }
    }
    if(topVC) {
        [topVC presentViewController:alert animated:YES completion:nil];
    }
}

static void dragView(UIPanGestureRecognizer *ges) {
    UIView *v = ges.view;
    CGPoint pt = [ges translationInView:v.superview];
    v.center = CGPointMake(v.center.x + pt.x, v.center.y + pt.y);
    [ges setTranslation:CGPointZero inView:v.superview];
}

@interface FloatHelper : NSObject
@end
@implementation FloatHelper
- (void)tapAction:(id)sender { showMenu(); }
- (void)panAction:(UIPanGestureRecognizer *)ges { dragView(ges); }
@end

static FloatHelper *helper;

%hook SpringBoard
- (void)applicationDidFinishLaunching {
    %orig;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if(g_floatBtn) return;
        helper = [[FloatHelper alloc] init];

        for (UIWindow *win in [UIApplication sharedApplication].windows) {
            if(win.isKeyWindow) {
                g_floatBtn = [UIButton buttonWithType:UIButtonTypeCustom];
                g_floatBtn.frame = CGRectMake(20,300,50,50);
                g_floatBtn.backgroundColor = [[UIColor darkGrayColor] colorWithAlphaComponent:0.7];
                [g_floatBtn setTitle:@"🔗" forState:UIControlStateNormal];
                g_floatBtn.layer.cornerRadius = 25;

                [g_floatBtn addTarget:helper action:@selector(tapAction:) forControlEvents:UIControlEventTouchUpInside];
                UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:helper action:@selector(panAction:)];
                [g_floatBtn addGestureRecognizer:pan];

                [win addSubview:g_floatBtn];
                break;
            }
        }
    });
}
%end
