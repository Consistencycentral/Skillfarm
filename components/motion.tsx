// ===========================================================================
// Small shared motion helpers (core Animated only, no extra packages).
//   PressableScale - springy press feedback (+ optional light haptic)
//   FadeInView     - gentle fade + rise when something appears
//   Pulse          - soft breathing opacity (skeleton loading)
//   TabIcon        - bottom-tab icon that pops + fills when selected
//   Pop            - quick "boing" when `trigger` changes (save / select)
// All animation is visual only; it never touches data or navigation logic.
// ===========================================================================
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { tapFeedback } from '../lib/haptics';

const native = Platform.OS !== 'web';
const APressable: any = Animated.createAnimatedComponent(Pressable);

type ScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: boolean;
  children?: ReactNode;
};

export function PressableScale({ style, scaleTo = 0.97, haptic = false, onPress, onPressIn, onPressOut, children, ...rest }: ScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const go = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: native, speed: 50, bounciness: 7 }).start();
  return (
    <APressable
      {...rest}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={(e: any) => { go(scaleTo); onPressIn?.(e); }}
      onPressOut={(e: any) => { go(1); onPressOut?.(e); }}
      onPress={(e: any) => { if (haptic) void tapFeedback(); onPress?.(e); }}
    >
      {children}
    </APressable>
  );
}

export function FadeInView({ children, delay = 0, distance = 12, duration = 380, style }: { children?: ReactNode; delay?: number; distance?: number; duration?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [v, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function Pulse({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      Animated.timing(v, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) }]}>{children}</Animated.View>;
}

export function Pop({ children, trigger, style }: { children?: ReactNode; trigger: unknown; style?: StyleProp<ViewStyle> }) {
  const s = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    s.setValue(0.72);
    Animated.spring(s, { toValue: 1, useNativeDriver: native, friction: 4, tension: 190 }).start();
  }, [trigger, s]);
  return <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>;
}

export function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const s = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: focused ? 1 : 0, useNativeDriver: native, friction: 5, tension: 150 }).start();
  }, [focused, s]);
  const scale = s.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const lift = s.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] });
  return (
    <Animated.View style={{ transform: [{ scale }, { translateY: lift }] }}>
      <Ionicons name={(focused ? name : `${name}-outline`) as any} size={22} color={color} />
    </Animated.View>
  );
}
