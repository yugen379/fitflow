import React from 'react';

export const PageSkeleton: React.FC = () => (
  <div className="pb-28 pt-4 px-4 space-y-5">
    <div className="space-y-2">
      <div className="h-3 w-20 rounded bg-white/[0.06] shimmer" />
      <div className="h-7 w-48 rounded bg-white/[0.06] shimmer" />
    </div>
    <div className="ff-fade-in space-y-3">
      <div className="glass h-32 shimmer" />
      <div className="grid grid-cols-2 gap-3">
        <div className="glass h-28 shimmer" />
        <div className="glass h-28 shimmer" />
      </div>
      <div className="glass h-40 shimmer" />
    </div>
  </div>
);
