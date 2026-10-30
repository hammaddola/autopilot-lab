/** Navigation entry point for pages (avoids importing the router/shell and creating cycles). */
export function navigate(path: string): void {
  location.hash = `#/${path}`;
}
