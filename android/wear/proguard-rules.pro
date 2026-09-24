# Wear app release shrinking (R8). Services/activities are kept via the manifest.
# Keep line numbers so crash stack traces stay readable.
-keepattributes SourceFile,LineNumberTable

# Health Services talks protobuf-lite, which looks up message fields by name
# (e.g. "name_") via reflection. Renaming them crashed HrService/ExerciseService
# at start ("Field name_ ... not found").
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite { <fields>; }
-keepclassmembers class * extends androidx.health.platform.client.proto.GeneratedMessageLite { <fields>; }
-keep class androidx.health.** { *; }
