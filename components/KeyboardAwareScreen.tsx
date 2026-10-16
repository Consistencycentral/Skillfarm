// ===========================================================================
// KeyboardAwareScreen — wraps a form screen so the keypad never covers the
// focused TextInput, on iOS, Android (incl. edge-to-edge) and web.
//
// v12.3 fix ("screen keeps moving / jumping while typing" on Android):
//   Root causes in v12.1/12.2:
//   1. On Android (edge-to-edge) the ScrollView viewport does NOT shrink when
//      the keyboard opens. React Native's native ScrollView still auto-scrolls
//      the focused field into view (requestChildFocus), and our own JS
//      scrollTo ran at the same time -> two scrolls fighting = jumping.
//   2. onTouchEnd re-ran the JS scroll after EVERY touch, including the end of
//      a normal scroll-drag, so the screen snapped back after the user scrolled.
//
//   Now (Android): we measure how much of the screen the keyboard really covers
//   and shrink the ScrollView's viewport by exactly that amount (wrapper
//   paddingBottom). With a correct viewport the native auto-scroll alone puts
//   the focused field above the keys (Android's own ScrollView also re-reveals
//   the focused field whenever its size changes). There is NO JS-driven
//   scrolling at all any more, so nothing can fight the native scroll.
//   Measuring (instead of assuming) means it is also correct on devices where
//   the OS already resizes the window - the inset just becomes 0.
//
//   • iOS      -> KeyboardAvoidingView (padding), unchanged
//   • Android  -> measured viewport inset (above)
//   • web      -> plain ScrollView
// ===========================================================================
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle,
  type ScrollViewProps, type StyleProp, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { theme } from '../constants/theme';

interface KeyboardAwareScreenProps extends ScrollViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const KeyboardAwareScreen = forwardRef<ScrollView, KeyboardAwareScreenProps>(
  function KeyboardAwareScreen({ children, style, contentContainerStyle, onScroll, ...scrollProps }, ref) {
    const scrollRef = useRef<ScrollView>(null);
    const wrapRef = useRef<View>(null);
    const offsetY = useRef(0);
    const keyboardTop = useRef<number | null>(null); // window-Y of the keyboard's top edge
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [inset, setInset] = useState(0);            // px of the viewport the keyboard covers
    useImperativeHandle(ref, () => scrollRef.current as ScrollView);

    // How much of the (full-height) wrapper is under the keyboard right now.
    const measureInset = useCallback(() => {
      if (Platform.OS !== 'android' || keyboardTop.current == null) return;
      wrapRef.current?.measureInWindow((_x, y, _w, h) => {
        if (keyboardTop.current == null) return;
        const covered = Math.max(0, Math.round(y + h - keyboardTop.current));
        // Only ever grow while the keyboard is open: switching between the number
        // pad and the letter keyboard must not resize the viewport back and forth.
        setInset((prev) => (covered > prev + 2 ? covered : prev));
      });
    }, []);

    useEffect(() => {
      if (Platform.OS !== 'android') return;
      const show = Keyboard.addListener('keyboardDidShow', (e) => {
        // v12.4: moving between fields (text <-> number pad) fires hide+show
        // back to back. Cancel the pending reset so the viewport doesn't flicker.
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
        keyboardTop.current = e.endCoordinates.screenY;
        measureInset();
      });
      const hide = Keyboard.addListener('keyboardDidHide', () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          keyboardTop.current = null;
          setInset(0);
        }, 200);
      });
      return () => {
        show.remove(); hide.remove();
        if (hideTimer.current) clearTimeout(hideTimer.current);
      };
    }, [measureInset]);

    const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetY.current = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    };

    const scroll = (
      <ScrollView
        ref={scrollRef}
        style={[styles.fill, style]}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    );

    if (Platform.OS === 'ios') {
      return <KeyboardAvoidingView style={styles.fill} behavior="padding">{scroll}</KeyboardAvoidingView>;
    }
    if (Platform.OS === 'android') {
      return (
        <View
          ref={wrapRef}
          style={[styles.fill, { paddingBottom: inset }]}
          onLayout={measureInset}
          collapsable={false}
        >
          {scroll}
        </View>
      );
    }
    return scroll;
  },
);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40, backgroundColor: theme.colors.background },
});
