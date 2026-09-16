/**
 * Provide facebook::react::Sealable debug ABI symbols for the app link.
 * Prebuilt React.framework is built with REACT_NATIVE_DEBUG but does not export
 * Sealable ctors; Fabric view pods (ExpoModulesCore, LiquidGlass, RNCPicker, …)
 * need them at link time. Keep pods on the debug Sealable layout so they match
 * React — do not force REACT_NATIVE_PRODUCTION on those pods.
 */
#include <react/renderer/core/Sealable.cpp>
