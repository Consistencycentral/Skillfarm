import { Tabs } from 'expo-router';
import { TabIcon } from '../../components/motion';
import { useTabOptions } from '../../constants/navStyle';
import { useLanguage } from '../../lib/i18n';

export default function ProviderTabs() {
  const tabOptions = useTabOptions();
  const { t } = useLanguage();
  return (
    <Tabs
      screenOptions={tabOptions}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t.dashboard,
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: t.courses,
          tabBarIcon: ({ color, focused }) => <TabIcon name="book" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: t.learners,
          tabBarIcon: ({ color, focused }) => <TabIcon name="people" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen name="attendance-scan" options={{ href: null, title: 'Scan Attendance' }} />
      <Tabs.Screen name="analytics" options={{ href: null, title: 'Analytics' }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.profile,
          tabBarIcon: ({ color, focused }) => <TabIcon name="business" color={color} focused={focused} />,
        }}
      />
      {/* Non-tab screen: per-course material uploads (opened from Courses). */}
      <Tabs.Screen
        name="course-materials/[courseId]"
        options={{ href: null, title: 'Course materials' }}
      />
      {/* Non-tab screen: add/edit course form. */}
      <Tabs.Screen
        name="course-edit"
        options={{ href: null, title: t.courseForm }}
      />
    </Tabs>
  );
}
