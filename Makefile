ARCHS = arm64 arm64e
TARGET = iphone:clang:17.0:15.0
INSTALL_TARGET_PROCESSES = SpringBoard

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = FloatLink

FloatLink_FILES = Tweak.x
FloatLink_CFLAGS = -fobjc-arc

include $(THEOS_MAKE_PATH)/tweak.mk
