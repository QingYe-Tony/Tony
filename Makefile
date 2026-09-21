ARCHS = arm64 arm64e
TARGET = iphone:clang:16.5:15.0
INSTALL_TARGET_PROCESSES = SpringBoard

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = FloatLink

FloatLink_FILES = Tweak.x
# 关闭未使用函数的报错，只保留警告
FloatLink_CFLAGS = -fobjc-arc -Wno-error=unused-function

include $(THEOS_MAKE_PATH)/tweak.mk
