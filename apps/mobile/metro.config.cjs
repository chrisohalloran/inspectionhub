const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspacePackagesRoot = `${path.resolve(projectRoot, "../../packages")}${path.sep}`;
const config = getDefaultConfig(projectRoot);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    const isWorkspaceSource = context.originModulePath.startsWith(
      workspacePackagesRoot,
    );
    if (!isWorkspaceSource || !moduleName.endsWith(".js")) {
      throw error;
    }

    return context.resolveRequest(
      context,
      `${moduleName.slice(0, -3)}.ts`,
      platform,
    );
  }
};

module.exports = config;
