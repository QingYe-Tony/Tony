#import <UIKit/UIKit.h>

static UIWindow *g_floatWindow;
static UIButton *g_floatBtn;

static void showMenu(void) {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"快捷链接" message:nil preferredStyle:UIAlertControllerStyleActionSheet];

    [alert addAction:[UIAlertAction actionWithTitle:@"百度" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://www.baidu.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"B站" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://www.bilibili.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Github" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        [[UIApplication sharedApplication] openURL:[NSURL URLWithString:@"https://github.com"] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"取消" style:UIAlertActionStyleCancel handler:nil]];

    UIViewController *root = g_floatWindow.rootViewController;
    [root presentViewController:alert animated:YES completion:nil];
}

%hook SpringBoard
- (void)applicationDidFinishLaunching:(id)app {
    %orig;
    dispatch_async(dispatch_get_main_queue(), ^{
        g_floatWindow = [[UIWindow alloc] initWithFrame:CGRectMake(20,300,50,50)];
        g_floatWindow.windowLevel = UIWindowLevelAlert + 100;
        g_floatWindow.hidden = NO;

        UIViewController *vc = [UIViewController new];
        g_floatWindow.rootViewController = vc;

        g_floatBtn = [UIButton buttonWithType:UIButtonTypeCustom];
        g_floatBtn.frame = CGRectMake(0,0,50,50);
        g_floatBtn.backgroundColor = [[UIColor darkGrayColor] colorWithAlphaComponent:0.65];
        g_floatBtn.layer.cornerRadius = 25;
        [g_floatBtn setTitle:@"🔗" forState:UIControlStateNormal];
        [g_floatBtn addTarget:nil action:@selector(showMenu) forControlEvents:UIControlEventTouchUpInside];

        // Block手势，不再需要单独dragView函数
        UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:g_floatBtn action:@selector(panRecognized:)];
        [pan setActionBlock:^(UIPanGestureRecognizer *ges){
            UIView *v = ges.view;
            CGPoint pt = [ges translationInView:v.superview];
            v.center = CGPointMake(v.center.x + pt.x, v.center.y + pt.y);
            [ges setTranslation:CGPointZero inView:v.superview];
        }];
        [g_floatBtn addGestureRecognizer:pan];

        [vc.view addSubview:g_floatBtn];
    });
}
%end
