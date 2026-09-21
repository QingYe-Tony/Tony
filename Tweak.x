#import <UIKit/UIKit.h>

static UIWindow *g_floatWindow;
static UIButton *g_floatBtn;

#define LINK_LIST @[\
@{@"name":@"百度",@"url":@"https://www.baidu.com"},\
@{@"name":@"B站",@"url":@"https://www.bilibili.com"},\
@{@"name":@"Github",@"url":@"https://github.com"}\
]

static void openLink(NSString *urlStr){
    NSURL *url = [NSURL URLWithString:urlStr];
    if([[UIApplication sharedApplication] canOpenURL:url]){
        [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:nil];
    }
}

static void showMenu(void){
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"快捷链接" message:nil preferredStyle:UIAlertControllerStyleActionSheet];
    
    for(NSDictionary *item in LINK_LIST){
        [alert addAction:[UIAlertAction actionWithTitle:item[@"name"] style:UIAlertActionStyleDefault handler:^(UIAlertAction * _Nonnull action) {
            openLink(item[@"url"]);
        }]];
    }
    
    [alert addAction:[UIAlertAction actionWithTitle:@"取消" style:UIAlertActionStyleCancel handler:nil]];
    
    UIViewController *topVC = g_floatWindow.rootViewController;
    [topVC presentViewController:alert animated:YES completion:nil];
}

static void dragView(UIPanGestureRecognizer *ges){
    CGPoint point = [ges translationInView:g_floatWindow];
    CGRect frame = g_floatWindow.frame;
    frame.origin.x += point.x;
    frame.origin.y += point.y;
    g_floatWindow.frame = frame;
    [ges setTranslation:CGPointZero inView:g_floatWindow];
}

%hook SpringBoard
- (void)applicationDidFinishLaunching:(id)arg1{
    %orig;
    
    dispatch_async(dispatch_get_main_queue(), ^{
        g_floatWindow = [[UIWindow alloc] initWithFrame:CGRectMake(20, 300, 50, 50)];
        g_floatWindow.windowLevel = UIWindowLevelAlert + 1000;
        g_floatWindow.hidden = NO;
        
        UIViewController *vc = [[UIViewController alloc] init];
        vc.view.backgroundColor = [UIColor clearColor];
        g_floatWindow.rootViewController = vc;
        
        g_floatBtn = [UIButton buttonWithType:UIButtonTypeCustom];
        g_floatBtn.frame = CGRectMake(0, 0, 50, 50);
        g_floatBtn.backgroundColor = [UIColor colorWithWhite:0 alpha:0.4];
        g_floatBtn.layer.cornerRadius = 25;
        g_floatBtn.clipsToBounds = YES;
        [g_floatBtn setTitle:@"🔗" forState:UIControlStateNormal];
        [g_floatBtn setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
        
        [g_floatBtn addTarget:g_floatBtn action:@selector(showMenu) forControlEvents:UIControlEventTouchUpInside];
        
        UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:g_floatBtn action:@selector(dragView:)];
        [g_floatBtn addGestureRecognizer:pan];
        
        [vc.view addSubview:g_floatBtn];
    });
}
%end
