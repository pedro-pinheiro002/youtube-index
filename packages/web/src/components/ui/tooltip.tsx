"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = BaseTooltip.Provider;

export const Tooltip = BaseTooltip.Root;

export const TooltipTrigger = BaseTooltip.Trigger;

export const TooltipPortal = BaseTooltip.Portal;

export const TooltipPositioner = BaseTooltip.Positioner;

export const TooltipPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTooltip.Popup>
>(function TooltipPopup({ className, ...props }, ref) {
  return (
    <BaseTooltip.Popup
      ref={ref}
      className={cn(
        "z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  );
});

export const TooltipArrow = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTooltip.Arrow>
>(function TooltipArrow({ className, ...props }, ref) {
  return <BaseTooltip.Arrow ref={ref} className={cn("fill-popover", className)} {...props} />;
});
