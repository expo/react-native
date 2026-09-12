#import <UIKit/UIKit.h>

/**
 * The scene that hosts the app's one window.
 *
 * Apps built with the iOS 27 SDK must adopt the scene life cycle — UIKit ends
 * one that does not at launch — so the window is the scene's, not the app
 * delegate's. React Native is started here, into that window, with the factory
 * and launch options the app delegate prepared.
 */
@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>

@property (nonatomic, strong, nullable) UIWindow *window;

@end
