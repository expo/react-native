/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

// AlertDialog is Dialog with confirm/cancel affordances; Action and Cancel
// are both Close (shadcn wires the handlers).
export {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title,
  Description,
  Close as Action,
  Close as Cancel,
} from '../dialog';
