#import <UIKit/UIKit.h>

static UIWindow *floatWin;
static UIButton *g_floatBtn;
static FloatHelper *helper;
static BOOL created = NO;

@interface FloatHelper : NSObject
@end
@implementation FloatHelper
- (void)tapAction:(id)sender {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"快捷链接" message:nil preferredStyle:UIAlertControllerStyleActionSheet];
    [alert addAction:[UIAlertAction actionWithTitle:@"百度" style:UIAlertActionStyleDefault handler:^(UIAlertAction *act){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://www.baidu.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"B站" style:UIAlertActionStyleDefault handler:^(UIAlertAction *act){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://bilibili.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"GitHub" style:UIAlertActionStyleDefault handler:^(UIAlertAction *act){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://github.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"取消" style:UIAlertActionStyleCancel handler:nil]];

    UIViewController *vc = [[UIViewController alloc] init];
    vc.view.backgroundColor = [UIColor clearColor];
    floatWin.rootViewController = vc;
    [vc presentViewController:alert animated:YES completion:nil];
}
- (void)panAction:(UIPanGestureRecognizer *)ges {
    CGPoint pt = [ges translationInView:g_floatBtn.superview];
    CGPoint center = g_floatBtn.center;
    g_floatBtn.center = CGPointMake(center.x + pt.x, center.y + pt.y);
    [ges setTranslation:CGPointZero inView:g_floatBtn.superview];
}
@end

%hook SpringBoard
- (void)_didFinishLaunching {
    %orig;
    if(created) return;
    created = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        helper = [[FloatHelper alloc] init];
        CGRect scr = [UIScreen mainScreen].bounds;
        floatWin = [[UIWindow alloc] initWithFrame:scr];
        floatWin.windowLevel = 1000000; // 最高层级，盖在桌面上面
        floatWin.hidden = NO;
        floatWin.backgroundColor = [UIColor clearColor];

        g_floatBtn = [UIButton buttonWithType:UIButtonTypeCustom];
        g_floatBtn.frame = CGRectMake(20,300,50,50);
        g_floatBtn.backgroundColor = [[UIColor darkGrayColor] colorWithAlphaComponent:0.7];
        [g_floatBtn setTitle:@"🔗" forState:UIControlStateNormal];
        g_floatBtn.layer.cornerRadius = 25;
        g_floatBtn.clipsToBounds = YES;

        [g_floatBtn addTarget:helper action:@selector(tapAction:) forControlEvents:UIControlEventTouchUpInside];
        UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:helper action:@selector(panAction:)];
        [g_floatBtn addGestureRecognizer:pan];
        [floatWin addSubview:g_floatBtn];
    });
}
%end
