#import <UIKit/UIKit.h>

static UIWindow *g_floatWindow;
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

    UIViewController *topVC = [UIApplication sharedApplication].keyWindow.rootViewController;
    [topVC presentViewController:alert animated:YES completion:nil];
}

static void dragView(UIPanGestureRecognizer *ges) {
    UIView *v = ges.view;
    CGPoint pt = [ges translationInView:v.superview];
    v.center = CGPointMake(v.center.x + pt.x, v.center.y + pt.y);
    [ges setTranslation:CGPointZero inView:v.superview];
}

%hook SpringBoard
- (void)applicationDidFinishLaunching {
    %orig;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if(g_floatWindow) return;

        g_floatWindow = [[UIWindow alloc] initWithFrame:CGRectMake(20,300,50,50)];
        g_floatWindow.windowLevel = 1000000;
        g_floatWindow.hidden = NO;

        g_floatBtn = [UIButton buttonWithType:UIButtonTypeCustom];
        g_floatBtn.frame = CGRectMake(0,0,50,50);
        g_floatBtn.backgroundColor = [[UIColor darkGrayColor] colorWithAlphaComponent:0.7];
        [g_floatBtn setTitle:@"🔗" forState:UIControlStateNormal];
        g_floatBtn.layer.cornerRadius = 25;
        
        // target 改成 nil + UIControlEventTouchUpInside，用事件监听；手势用全局函数做selector，加个中间转发
        [g_floatBtn addTarget:nil action:@selector(showMenu) forControlEvents:UIControlEventTouchUpInside];
        
        UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:nil action:@selector(dragView:)];
        [g_floatBtn addGestureRecognizer:pan];

        [g_floatWindow addSubview:g_floatBtn];
    });
}
%end
