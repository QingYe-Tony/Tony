ARCHS = arm64
TARGET = iphone:clang:15.0:15.0
INSTALL_TARGET_PROCESSES = SpringBoard

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = FloatURL

FloatURL_FILES = Tweak.x
FloatURL_CFLAGS = -fobjc-arc

include $(THEOS_MAKE_PATH)/tweak.mk
