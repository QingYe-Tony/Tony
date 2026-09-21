ARCHS = arm64 arm64e
TARGET = iphone:clang:16.5:15.0
THEOS_PACKAGE_SCHEME = rootless
# 关闭废弃声明警告，不让警告变成error
CFLAGS += -Wno-deprecated-declarations

INSTALL_TARGET_PROCESSES = SpringBoard

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = FloatLink

FloatLink_FILES = Tweak.x
FloatLink_CFLAGS = -fobjc-arc

include $(THEOS_MAKE_PATH)/tweak.mk
