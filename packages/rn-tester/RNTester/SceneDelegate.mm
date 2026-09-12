#import "SceneDelegate.h"

#import "AppDelegate.h"

@implementation SceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:UIWindowScene.class]) {
    return;
  }
  AppDelegate *app = (AppDelegate *)UIApplication.sharedApplication.delegate;
  self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
  [app.reactNativeFactory startReactNativeWithModuleName:@"RNTesterApp"
                                                inWindow:self.window
                                       initialProperties:[app prepareInitialProps]
                                           launchOptions:app.launchOptions];
}

@end
