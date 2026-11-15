import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./src/remotion/index.ts");

// A Chrome already installed on this machine (otherwise Remotion downloads its own).
const browser = process.env.REELS_BROWSER_EXECUTABLE;
if (browser) Config.setBrowserExecutable(browser);
