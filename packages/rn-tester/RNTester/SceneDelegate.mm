#import "SceneDelegate.h"

#import "AppDelegate.h"

#import <React/EXPKeyboardTrace.h>

/*
 * The touch trace's own menu, on a two-finger double-tap.
 *
 * A gesture rather than the dev menu because the build that matters is the one
 * on a phone: `RCTDevMenu` is compiled out of Release, and an intermittent
 * scroll failure is reported from ordinary use, not from a debug session.
 *
 * CLEAR is the whole design. The first version of this was going to decide for
 * itself which touch sequences were interesting — keep the ones where a finger
 * moved and the list did not — and throw the rest away. The reporter asked for
 * a button instead: "there's no chance that inferring ends up dropping data we
 * care about." A ring buffer bounds VOLUME, which is a fact about memory; only
 * a person can bound RELEVANCE, and they do it by clearing right before making
 * the bug happen.
 */
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

  [EXPKeyboardTrace start];
  EXPKeyboardTrace.touchTracing = YES;

  UITapGestureRecognizer *dump = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                        action:@selector(_showTouchTraceMenu:)];
  dump.numberOfTouchesRequired = 2;
  dump.numberOfTapsRequired = 2;
  // Takes nothing: the app under test is the thing being diagnosed, and a
  // diagnostic that swallows touches changes the behaviour it is watching.
  dump.cancelsTouchesInView = NO;
  dump.delaysTouchesBegan = NO;
  dump.delaysTouchesEnded = NO;
  [self.window addGestureRecognizer:dump];
}

- (void)_showTouchTraceMenu:(UIGestureRecognizer *)recognizer
{
  NSString *trace = [EXPKeyboardTrace dump];
  const NSUInteger lines = [trace componentsSeparatedByString:@"\n"].count;
  UIAlertController *menu =
      [UIAlertController alertControllerWithTitle:@"Touch trace"
                                          message:[NSString stringWithFormat:@"%lu lines", (unsigned long)lines]
                                   preferredStyle:UIAlertControllerStyleAlert];
  [menu addAction:[UIAlertAction actionWithTitle:@"Copy"
                                           style:UIAlertActionStyleDefault
                                         handler:^(UIAlertAction *_Nonnull action) {
                                           UIPasteboard.generalPasteboard.string = trace;
                                         }]];
  // Clear, then go and make it happen: everything after this is the report.
  [menu addAction:[UIAlertAction actionWithTitle:@"Clear"
                                           style:UIAlertActionStyleDestructive
                                         handler:^(UIAlertAction *_Nonnull action) {
                                           [EXPKeyboardTrace start];
                                           EXPKeyboardTrace.touchTracing = YES;
                                         }]];
  [menu addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
  [self.window.rootViewController presentViewController:menu animated:YES completion:nil];
}

@end
