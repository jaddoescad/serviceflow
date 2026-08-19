module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Required by Reanimated 4 / react-native-worklets. Must stay last.
    plugins: ["react-native-worklets/plugin"]
  };
};
