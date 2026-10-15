#import "SceneDelegate.h"

#import "AppDelegate.h"
#import "RCTReactNativeFactory.h"

#import <React/RCTLinkingManager.h>

#if __has_include(<ExpoModulesCore/ExpoModulesCore-Swift.h>)
#import <ExpoModulesCore/ExpoModulesCore-Swift.h>
#else
#import "ExpoModulesCore-Swift.h"
#endif

// Expo Router reads the URL the app was opened with from expo-linking, which
// hears of opened URLs through Expo's app delegate subscribers. The app has
// none of Expo's app delegate (AppDelegate.mm), and with the scene life cycle
// UIKit gives the URLs to the scene, so the scene hands them on.
static void ForwardURLContextsToExpo(NSSet<UIOpenURLContext *> *URLContexts)
{
  static dispatch_once_t registered;
  dispatch_once(&registered, ^{
    [EXExpoAppDelegateSubscriberRepository
        registerSubscribersFromModulesProvider:[EXAppContext modulesProviderWithName:@"ExpoModulesProvider"]];
  });
  for (UIOpenURLContext *context in URLContexts) {
    NSMutableDictionary<UIApplicationOpenURLOptionsKey, id> *options = [NSMutableDictionary new];
    options[UIApplicationOpenURLOptionsSourceApplicationKey] = context.options.sourceApplication;
    options[UIApplicationOpenURLOptionsAnnotationKey] = context.options.annotation;
    options[UIApplicationOpenURLOptionsOpenInPlaceKey] = @(context.options.openInPlace);
    [ExpoAppDelegateSubscriberManager application:UIApplication.sharedApplication open:context.URL options:options];
  }
}

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
  // A cold start from a link (`astryxdemo://template/<slug>`): the URL comes
  // with the connection, before JavaScript runs, so it is the initial URL that
  // Linking and expo-linking report, not an event nothing is listening for yet
  ForwardURLContextsToExpo(connectionOptions.URLContexts);
  [app.factory startReactNativeWithModuleName:@"main"
                                     inWindow:self.window
                            initialProperties:nil
                            connectionOptions:connectionOptions];
}

// With the scene life cycle UIKit delivers opened URLs here, not to the
// application delegate; Expo Router navigates on Linking's `url` event
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  ForwardURLContextsToExpo(URLContexts);
  [RCTLinkingManager scene:scene openURLContexts:URLContexts];
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  [RCTLinkingManager scene:scene continueUserActivity:userActivity];
}

@end
