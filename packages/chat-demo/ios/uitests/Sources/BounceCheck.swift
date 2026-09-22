import XCTest

/*
 A bounce off the end does not re-lay out the transcript.

 A flick that carries the list past its end leaves UIKit decelerating back to
 the end, and while it is out there every content-size change makes UIKit clamp
 the offset to the end before the view puts it back. Those two writes are one
 repair and nobody should see the middle of it — but a second scroll delegate
 did: the row virtualiser swept the rows at both offsets, two hundred points
 apart, flipped the modes of the rows in between, and React re-laid the
 transcript. Where a row's hidden placeholder and its rendered height differed
 by a third of a point, that layout changed the content size, which clamped the
 offset again. Measured on a device: ninety layouts in two hundred
 milliseconds, the bounce frozen for most of them, and the reader saw it as
 "choppy".

 This case produces the bounces; the gate reads the trace, where a `state cs`
 line is a layout and the `offset` line before it says whether the list was
 decelerating from beyond the end, and allows nothing under a point inside one.
 The test itself asserts what it can see: the list came home with the newest
 message where it belongs.
 */
final class BounceCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  /*
   A hundred rows, so that the prerender edge — five viewports up, around row
   forty — has hidden rows above it and rendered rows below. A three-row chat
   has nothing to flip: a bounce over it is a bounce over nothing.
   */
  override class var seedMessages: Int? { 100 }

  func testABounceOffTheEndDoesNotReLayOutTheTranscript() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the keyboard never came up, so nothing can be typed")
    let body = "Bounce \(Int(Date().timeIntervalSince1970) % 100000)"
    app.typeText(body)
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    send.tap()
    XCTAssertTrue(text(body).waitForExistence(timeout: 10), "the message never arrived")

    /*
     Three flicks, back to back, each carrying the list past its end. A flick
     costs XCUITest the better part of two seconds to deliver, so they are not
     timed against the receipts — Delivered a little over a second after the
     send, Read a second or so after that — and whichever of the two lands
     while the list is out past the end is a change of thirteen points inside a
     bounce, which the gate's check allows. What it does not allow is a change
     of under a point there, and that needs no receipt: on the unfixed app
     every one of these flicks produced exactly one.

     Upward, in the transcript's own area above the keyboard: the finger moves
     up, the content follows it, and the end comes past.
     */
    let window = app.windows.element(boundBy: 0)
    let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
    let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
    for _ in 0..<3 {
      from.press(forDuration: 0.02, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0)
    }
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertTrue(
      isOnScreen(text(body)),
      "after bouncing off the end the newest message is not on screen; visible: \(visibleText())")
  }
}
