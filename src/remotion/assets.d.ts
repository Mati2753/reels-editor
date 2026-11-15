// Font files imported by the Remotion bundle resolve to URLs (Remotion's webpack config).
declare module "*.ttf" {
  const url: string;
  export default url;
}
