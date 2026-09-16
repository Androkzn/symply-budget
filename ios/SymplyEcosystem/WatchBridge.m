//
//  WatchBridge.m
//  SymplyEcosystem
//
//  Objective-C bridge for exposing WatchBridge Swift class to React Native
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WatchBridge, RCTEventEmitter)

/// Sync authentication tokens to Apple Watch
RCT_EXTERN_METHOD(syncAuthTokens:(NSString *)token
                  householdId:(NSString *)householdId
                  userId:(NSString *)userId)

/// Sync tasks to Apple Watch
RCT_EXTERN_METHOD(syncTasksToWatch:(NSString *)tasksJson)

/// Clear watch data (on logout)
RCT_EXTERN_METHOD(clearWatchData)

/// Check if watch is connected and reachable
RCT_EXTERN_METHOD(isWatchReachable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

/// Sync today's Aihousekeeper briefing to the Watch (plan §H7)
RCT_EXTERN_METHOD(syncBriefing:(NSString *)paragraph
                  date:(NSString *)date)

/// Persist the API base URL for the Watch / Home Screen widget extensions
RCT_EXTERN_METHOD(setApiBaseUrl:(NSString *)url)

/// Push the freshest Home insight JSON to the Home Screen widget
RCT_EXTERN_METHOD(syncHomeInsight:(NSString *)json)

/// Push the latest task feed JSON to the Home Screen widget
RCT_EXTERN_METHOD(syncWidgetTasks:(NSString *)json)

/// Force a Home Screen widget timeline refresh
RCT_EXTERN_METHOD(reloadWidgets)

@end
