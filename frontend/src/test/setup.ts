import { vi } from 'vitest';
import React from 'react';
import '@testing-library/jest-dom/vitest';

// React 19 removed React.act but @testing-library/react 16.x still needs it via
// react-dom/test-utils -> React.act. Patch it directly on the React object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(React as any).act = React.act ?? ((cb: () => void) => {
  const result = cb();
  return {
    then: (resolve: () => void) => {
      resolve();
      return { catch: () => {} };
    },
  };
});
