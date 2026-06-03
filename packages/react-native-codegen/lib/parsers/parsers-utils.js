'use strict';

function nullGuard(fn) {
  return fn();
}
module.exports = {
  nullGuard
};