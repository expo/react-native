# Forms

`<form>` and the controls that belong to it. The controls themselves are
described in [UIKitElements.md](UIKitElements.md); this is about what turns a
group of them into a submission.

## An element may be a component

Most elements are a box the renderer mounts. `<form>` is not — gathering its
controls and submitting them is not layout — so the tag resolves to a JavaScript
component that renders a plain block box. `<select>`, `<input>`, `<textarea>`
and `<button>` are components for the same reason: each needs to do something a
bare host element cannot.

The routing happens in the reconciler, next to the view-config fallback, so it
holds however the element was created — `React.createElement('form', …)` and a
cloned element behave exactly like JSX. See §"An element may be a component" in
UIKitElements.md for the mechanism.

## How a control finds its form

In HTML the association is by containment: a form walks its own subtree and
reads each control's `value`. There is no subtree here that holds live values —
they are in native views — so the direction is reversed. Each control registers
a **getter** with the nearest form through context, and the form asks at submit
time.

The reversal is what makes **uncontrolled** controls work, and that is the whole
reason it is built this way. An uncontrolled `<input>` keeps its value in the
native view and never tells JavaScript about it. A form could not read it after
the fact; a control that answers for itself can. That is the same answer the DOM
gives, arrived at from the other side.

Registration order is mount order, which is tree order for the case that matters
— and order is not incidental, because `formData.getAll('tag')` depends on it.

## What is submitted

The rules that are invisible until a server disagrees with you:

| Rule                        | Behaviour                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| unnamed control             | not submitted — how a Cancel button stays out of the data                                |
| unchecked checkbox or radio | contributes **nothing**, not `""` — `formData.has(name)` is how handlers tell them apart |
| checked box with no `value` | submits `"on"`                                                                           |
| `<select>` with no match    | submits its first option, which is what an untouched one shows                           |
| buttons                     | not submitted                                                                            |

## Encoding

HTML's default is **`application/x-www-form-urlencoded`** — both the
missing-value and invalid-value default in the spec, so an unrecognised
`enctype` falls back to it rather than erroring.

This is worth stating loudly because it is the opposite of what a `FormData`
object suggests: handing a `FormData` to `fetch` sends **multipart**. A form
that looked like it followed HTML would in fact post something most servers
parse differently — and that an Expo Router API route calling `request.json()`
rejects either way. The submission therefore carries an already-encoded body so
a handler cannot get it wrong.

Two details that fall out of the spec and surprise people:

- a file in an urlencoded form submits its **name**, not its bytes, which is
  _why_ uploads need `multipart/form-data`;
- a GET **replaces** the action's query string rather than merging with it, so
  an existing `?page=2` does not survive the submission.

`method="dialog"` — which closes the enclosing `<dialog>` without submitting —
is not implemented, because `<dialog>` is not.

## `FormData`

React Native's `FormData` polyfill had only `append`, `getAll` and `getParts`.
`<form action={fn}>` hands this object to application code, and the first line
of nearly every React 19 form action is `formData.get('email')` — so the rest of
the interface was added: `get`, `has`, `set`, `delete`, `entries`, `keys`,
`values`, and iteration.

Two behaviours there are load-bearing: `get` returns `null` rather than `""`, so
absent and blank stay distinguishable; and `set` keeps the **position** of the
first entry it replaces, so it cannot silently reorder a form.

## Submitting

`onSubmit` runs first and may `preventDefault()`, which is the DOM's order.
Then:

### `action={fn}` — the primary path

React 19's form action. The function is called with the `FormData`, and nothing
navigates. Identical on every platform, which is why it is the one to reach for.

After a **successful** action the form's _uncontrolled_ fields reset, matching
React on the web: "after the action function succeeds, all uncontrolled field
elements in the form are reset". Only on success — a rejected action leaves what
the user typed alone. Controlled fields are untouched either way.

Resetting a control means recreating its native view. Restoring the remembered
value is not enough: an uncontrolled control applies its default once when the
view is created and never again (or every prop update would undo the user's
typing), so without the recreation the field would still _show_ what was typed
while the form believed it was clear.

### `action="/some/url"` — announced, and handled by whoever owns navigation

Submitting to a URL is a **navigation** on the web: GET puts the fields in the
query string, POST sends a body, and in both cases the response replaces the
current document. That is why POST-redirect-GET exists.

Neither is something this package can do, and — the part that took a wrong turn
first — neither is something it should _approximate_. So **the default action is
nothing**: the submission is announced, and with nobody listening there is no
navigation and, deliberately, **no network request**. Firing a `fetch` and
dropping the response would not be the default action minus the navigation; it
would send the user's data with no result, no error surfaced, and nothing to
stop it happening twice.

That is not a failure state. It is a form whose submission nobody was listening
for — which is what a `<form>` on a page with no server does.

A library hooks in by providing `FormSubmitContext` above the forms it wants to
handle:

```js
<FormSubmitContext.Provider value={submission => { /* navigate, or request */ }}>
```

Context rather than a global registration, so handling can be scoped and can
nest. It stands in for the true DOM shape — a cancelable `submit` event bubbling
to the root — until events can be dispatched from JavaScript into the element
tree.

**What the router has to decide**, and why only it can:

- an action naming a **screen** is a navigation, fields riding along as
  parameters. A GET form to a screen — a search box — is the case that genuinely
  is a navigation on both platforms;
- an action naming an **API route** is a request. An Expo Router API route (a
  `+api.ts` exporting `GET`/`POST`) returns a `Response`, usually JSON, and
  renders no page — so "navigate to the result" has nothing to navigate to. On
  the web a browser would replace your app with a JSON document; on a device
  there is no document to replace at all. The pattern that works on both is the
  one the web settled on: the route replies `Response.redirect(...)` and the
  router follows it to a screen.

On a device, posting a form is about **sending data to a server** rather than
navigating, so an app that needs the response should use `action={fn}` and read
it directly.

### On the web

The router has _more_ work there, not less. React prevents the default only for
a **function** action: "an `action` runs in a Transition and calling
`e.preventDefault()` isn't needed". For a **string** action, "the form will
behave like the HTML form component" — the browser does a full document
navigation and takes the single-page app with it. Anything wanting client-side
routing has to intercept that itself.
