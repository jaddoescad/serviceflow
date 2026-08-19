// Nitro Views (VisionCamera v5's PreviewView) pass jsi::Value-backed props,
// which RN 0.81's RawPropsParser only supports behind this feature flag.
// Without it, mounting the camera throws "Cannot cast dynamic to a jsi::Value".
// +load runs at dyld time, before any React code reads the flags.

#import <Foundation/Foundation.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsDefaults.h>

#include <memory>

namespace {

class ServiceFlowFeatureFlags : public facebook::react::ReactNativeFeatureFlagsDefaults {
 public:
  bool useRawPropsJsiValue() override {
    return true;
  }
};

} // namespace

@interface ServiceFlowFeatureFlagsInitializer : NSObject
@end

@implementation ServiceFlowFeatureFlagsInitializer

+ (void)load {
  facebook::react::ReactNativeFeatureFlags::override(
      std::make_unique<ServiceFlowFeatureFlags>());
}

@end
