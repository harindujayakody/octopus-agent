/** An extension icon as the backend builds it: an image data URL. Anything
 *  else (a remote URL) is not shown, so no third party learns the user's IP
 *  from an icon (SEC-17). */
export const iconSrc = (icon: string): string => (icon.startsWith("data:image/") ? icon : "");
