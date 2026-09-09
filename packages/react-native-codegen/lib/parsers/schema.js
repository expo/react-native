'use strict';

function wrapComponentSchema({
  filename,
  componentName,
  extendsProps,
  events,
  props,
  options,
  commands
}) {
  return {
    modules: {
      [filename]: {
        type: 'Component',
        components: {
          [componentName]: {
            ...(options || {}),
            extendsProps,
            events,
            props,
            commands
          }
        }
      }
    }
  };
}
module.exports = {
  wrapComponentSchema
};