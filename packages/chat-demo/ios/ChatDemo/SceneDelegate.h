#import <UIKit/UIKit.h>

/**
 * Creates the window and starts React Native. With the iOS 27 SDK, UIKit ends an
 * app at launch if it doesn't use the scene life cycle, so the window can't be
 * created in AppDelegate.
 */
@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>

@property (nonatomic, strong, nullable) UIWindow *window;

@end
