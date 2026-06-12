import React from 'react';
import { motion } from 'motion/react';

/**
 * Wrap a route's content for a fast spring slide+fade entrance.
 * Keep the duration short so navigations still feel snappy on mobile.
 */
export const PageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 12, scale: 0.985 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -8, scale: 0.985 }}
    transition={{ type: 'spring', stiffness: 280, damping: 28, mass: 0.6 }}
  >
    {children}
  </motion.div>
);
