#import "SceneDelegate.h"

#import "AppDelegate.h"
#import "RCTReactNativeFactory.h"

#import <React/RCTLinkingManager.h>

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
  [app.factory startReactNativeWithModuleName:@"main"
                                     inWindow:self.window
                            initialProperties:nil
                                launchOptions:app.launchOptions];
  // A cold start from a link (`astryxdemo://template/<slug>`): the URL arrives
  // with the connection, not through scene:openURLContexts:
  if (connectionOptions.URLContexts.count > 0) {
    [RCTLinkingManager scene:scene openURLContexts:connectionOptions.URLContexts];
  }
}

// With the scene life cycle UIKit delivers opened URLs here, not to the
// application delegate; Expo Router reads them through Linking
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  [RCTLinkingManager scene:scene openURLContexts:URLContexts];
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  [RCTLinkingManager scene:scene continueUserActivity:userActivity];
}

@end
