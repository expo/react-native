#import "SceneDelegate.h"

#import "AppDelegate.h"
#import "RCTReactNativeFactory.h"

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
  [app.factory startReactNativeWithModuleName:@"ChatDemo"
                                     inWindow:self.window
                            initialProperties:app.initialProperties
                                launchOptions:app.launchOptions];

  // Two fingers, two taps, anywhere: the geometry trace to the pasteboard.
  UITapGestureRecognizer *copyTrace = [[UITapGestureRecognizer alloc] initWithTarget:app action:@selector(copyTrace:)];
  copyTrace.numberOfTouchesRequired = 2;
  copyTrace.numberOfTapsRequired = 2;
  copyTrace.cancelsTouchesInView = NO;
  [self.window addGestureRecognizer:copyTrace];
}

@end
