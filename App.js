
import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, TextInput, Pressable, FlatList, Alert, Platform, KeyboardAvoidingView, ScrollView, Switch, Modal, StatusBar, BackHandler } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const STORAGE_KEY = "@timetable_entries_v1";
const EXAM_MODE_KEY = "@exam_mode_v1";
const EXAM_ENTRIES_KEY = "@exam_entries_v1";
const SUBJECT_TEMPLATES_KEY = "@subject_templates_v1";
const TIME_TEMPLATES_KEY = "@time_templates_v1";
const EXAM_SUBJECT_TEMPLATES_KEY = "@exam_subject_templates_v1";
const EXAM_TIME_TEMPLATES_KEY = "@exam_time_templates_v1";
const EXAM_TITLE_TEMPLATES_KEY = "@exam_title_templates_v1";
const EXAM_SCHEDULE_TEMPLATES_KEY = "@exam_schedule_templates_v1";

// Purple Color Scheme
const COLORS = {
  primary: "#7B2CBF", // Purple
  primaryDark: "#5A189A",
  background: "#000000", // AMOLED Black
  surface: "transparent", // Made transparent for seamless AMOLED look
  surfaceVariant: "#111111", // Very subtle for input fields only
  onSurface: "#FFFFFF",
  onSurfaceVariant: "#CCCCCC",
  accent: "#C77DFF",
  error: "#CF6679",
  warning: "#F72585",
  border: "#2C2C2C"
};

// Use JS getDay() convention: 0=Sunday, 1=Monday, ..., 6=Saturday
const DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

function parseTimeToHM(timeStr) {
  // Handle both 12-hour (9:00 AM, 2:30 PM) and 24-hour (14:30) formats
  const ampm = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(timeStr || "");
  if (ampm) {
    let h = Number(ampm[1]);
    let mm = Number(ampm[2]);
    const isPM = ampm[3].toUpperCase() === 'PM';
    
    if (Number.isNaN(h) || Number.isNaN(mm) || h < 1 || h > 12 || mm < 0 || mm > 59) return null;
    
    // Convert to 24-hour format
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    
    return { hour: h, minute: mm };
  }
  
  // Fallback to 24-hour format for backwards compatibility
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(timeStr || "");
  if (!m) return null;
  let h = Number(m[1]);
  let mm = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { hour: h, minute: mm };
}

function formatTimeTo12Hour(hour, minute) {
  const isPM = hour >= 12;
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const displayMinute = minute.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${isPM ? 'PM' : 'AM'}`;
}

function formatTimeFrom24Hour(timeStr) {
  const parsed = parseTimeToHM(timeStr);
  if (!parsed) return timeStr;
  return formatTimeTo12Hour(parsed.hour, parsed.minute);
}

function adjustForLead(weekday, hour, minute, leadMinutes) {
  let total = hour * 60 + minute - (leadMinutes || 0);
  let wd = weekday;
  if (total < 0) {
    total += 1440;
    wd = wd - 1 < 1 ? 7 : wd - 1;
  }
  const newHour = Math.floor(total / 60);
  const newMinute = total % 60;
  return { weekday: wd, hour: newHour, minute: newMinute };
}

async function ensureNotificationPermission() {
  if (!Device.isDevice) {
    Alert.alert("Development Mode", "Notifications require a physical device. Use development build for full functionality.");
    return false;
  }
  
  try {
    const settings = await Notifications.getPermissionsAsync();
    let finalStatus = settings.status;
    
    if (finalStatus !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
    }
    
    if (finalStatus !== "granted") {
      Alert.alert("Permissions required", "Enable notifications in Settings to receive class reminders.");
      return false;
    }
    
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("classes", {
        name: "Class Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#7B2CBF",
        sound: "default",
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
    
    return true;
  } catch (error) {
    console.warn("Notification setup warning:", error.message);
    // Still return true to allow app to function without notifications in development
    return true;
  }
}

export default function App() {
  const [entries, setEntries] = useState([]);
  const [examEntries, setExamEntries] = useState([]);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [selectedDay, setSelectedDay] = useState('Monday');
  const [isExamMode, setIsExamMode] = useState(false);
  const [examStartDate, setExamStartDate] = useState('');
  const [examEndDate, setExamEndDate] = useState('');
  const [showExamSettings, setShowExamSettings] = useState(false);
  const [showSubjectTemplate, setShowSubjectTemplate] = useState(false);
  const [showTimeTemplate, setShowTimeTemplate] = useState(false);
  
  // Enhanced exam scheduling
  const [examDuration, setExamDuration] = useState("2");
  const [examsPerDay, setExamsPerDay] = useState("1");
  const [examGap, setExamGap] = useState("15");
  const [examTitle, setExamTitle] = useState("");
  const [showExamScheduleModal, setShowExamScheduleModal] = useState(false);
  const [examStartTime, setExamStartTime] = useState("9:00 AM");
  
  // Form input states
  const [subject, setSubject] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [weekday, setWeekday] = useState(2);
  const [lead, setLead] = useState('10');
  const [examMode, setExamMode] = useState(false);
  const [newTemplate, setNewTemplate] = useState('');
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showExamSubjectModal, setShowExamSubjectModal] = useState(false);
  const [showExamTimeModal, setShowExamTimeModal] = useState(false);
  
  // Input mode toggles
  const [useTimePicker, setUseTimePicker] = useState(true);
  const [useDatePicker, setUseDatePicker] = useState(true);
  
  // Timetable navigation
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Date and Time picker states
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [startTimeDate, setStartTimeDate] = useState(new Date());
  const [endTimeDate, setEndTimeDate] = useState(new Date());
  const [examStartDateObj, setExamStartDateObj] = useState(new Date());
  const [examEndDateObj, setExamEndDateObj] = useState(new Date());
  
  // Template states
  const [subjectTemplates, setSubjectTemplates] = useState([]);
  const [timeTemplates, setTimeTemplates] = useState([]);
  const [examSubjectTemplates, setExamSubjectTemplates] = useState([]);
  const [examTimeTemplates, setExamTimeTemplates] = useState([]);
  const [examTitleTemplates, setExamTitleTemplates] = useState([]);
  const [examScheduleTemplates, setExamScheduleTemplates] = useState([]);

  useEffect(() => {
    // Set fullscreen - hide status bar and navigation bar
    StatusBar.setHidden(true, 'fade');
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor('transparent', true);
      StatusBar.setTranslucent(true);
    }
    
    ensureNotificationPermission();
    loadEntries();
    loadTemplates();
    loadExamMode();
    checkExamModeStatus();
    
    // Update current time every minute for live highlighting
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    
    // Android back button handler
    const backAction = () => {
      // Handle back button based on current modal state
      if (showExamScheduleModal) {
        setShowExamScheduleModal(false);
        return true; // Prevent default back action
      }
      if (showSubjectModal) {
        setShowSubjectModal(false);
        return true;
      }
      if (showTimeModal) {
        setShowTimeModal(false);
        return true;
      }
      if (showExamSubjectModal) {
        setShowExamSubjectModal(false);
        return true;
      }
      if (showExamTimeModal) {
        setShowExamTimeModal(false);
        return true;
      }
      if (showStartTimePicker || showEndTimePicker || showStartDatePicker || showEndDatePicker) {
        setShowStartTimePicker(false);
        setShowEndTimePicker(false);
        setShowStartDatePicker(false);
        setShowEndDatePicker(false);
        return true;
      }
      
      // If no modals are open, show exit confirmation
      Alert.alert(
        "Exit App",
        "Are you sure you want to exit Smart Table?",
        [
          {
            text: "Cancel",
            onPress: () => null,
            style: "cancel"
          },
          { 
            text: "Exit", 
            onPress: () => BackHandler.exitApp(),
            style: "destructive"
          }
        ]
      );
      return true; // Prevent default back action
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => {
      clearInterval(timer);
      backHandler.remove();
    };
  }, [showExamScheduleModal, showSubjectModal, showTimeModal, showExamSubjectModal, showExamTimeModal, showStartTimePicker, showEndTimePicker, showStartDatePicker, showEndDatePicker]);

  async function loadEntries() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const examRaw = await AsyncStorage.getItem(EXAM_ENTRIES_KEY);
      if (raw) setEntries(JSON.parse(raw));
      if (examRaw) setExamEntries(JSON.parse(examRaw));
    } catch (e) {
      console.warn("Failed loading entries", e);
    }
  }

  async function loadTemplates() {
    try {
      const subjects = await AsyncStorage.getItem(SUBJECT_TEMPLATES_KEY);
      const times = await AsyncStorage.getItem(TIME_TEMPLATES_KEY);
      const examSubjects = await AsyncStorage.getItem(EXAM_SUBJECT_TEMPLATES_KEY);
      const examTimes = await AsyncStorage.getItem(EXAM_TIME_TEMPLATES_KEY);
      const examTitles = await AsyncStorage.getItem(EXAM_TITLE_TEMPLATES_KEY);
      const examSchedules = await AsyncStorage.getItem(EXAM_SCHEDULE_TEMPLATES_KEY);
      
      if (subjects) setSubjectTemplates(JSON.parse(subjects));
      if (times) setTimeTemplates(JSON.parse(times));
      if (examSubjects) setExamSubjectTemplates(JSON.parse(examSubjects));
      if (examTimes) setExamTimeTemplates(JSON.parse(examTimes));
      if (examTitles) setExamTitleTemplates(JSON.parse(examTitles));
      if (examSchedules) setExamScheduleTemplates(JSON.parse(examSchedules));
      
      // Set default exam templates if none exist
      if (!examTitles) {
        const defaultTitles = ["Midterm Exam", "Final Exam", "Quiz", "Unit Test", "Semester Exam", "Internal Test"];
        setExamTitleTemplates(defaultTitles);
        await AsyncStorage.setItem(EXAM_TITLE_TEMPLATES_KEY, JSON.stringify(defaultTitles));
      }
      
      if (!examSchedules) {
        const defaultSchedules = [
          { name: "Morning Session", duration: "3", examsPerDay: "2", gap: "30", startTime: "9:00 AM" },
          { name: "Afternoon Session", duration: "2", examsPerDay: "3", gap: "15", startTime: "2:00 PM" },
          { name: "Full Day", duration: "2", examsPerDay: "4", gap: "20", startTime: "9:00 AM" }
        ];
        setExamScheduleTemplates(defaultSchedules);
        await AsyncStorage.setItem(EXAM_SCHEDULE_TEMPLATES_KEY, JSON.stringify(defaultSchedules));
      }
    } catch (e) {
      console.warn("Failed loading templates", e);
    }
  }

  async function loadExamMode() {
    try {
      const examModeData = await AsyncStorage.getItem(EXAM_MODE_KEY);
      if (examModeData) {
        const data = JSON.parse(examModeData);
        setExamStartDate(data.startDate || "");
        setExamEndDate(data.endDate || "");
        setExamMode(data.enabled || false);
      }
    } catch (e) {
      console.warn("Failed loading exam mode", e);
    }
  }

  async function checkExamModeStatus() {
    try {
      const examModeData = await AsyncStorage.getItem(EXAM_MODE_KEY);
      if (examModeData) {
        const data = JSON.parse(examModeData);
        const now = new Date();
        
        // Parse DD/MM/YYYY date format
        const parseExamDate = (dateStr) => {
          if (!dateStr || !dateStr.includes('/')) return null;
          const [day, month, year] = dateStr.split('/');
          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        };
        
        const start = parseExamDate(data.startDate);
        const end = parseExamDate(data.endDate);
        
        if (data.enabled && start && end && start <= now && now <= end) {
          setIsExamMode(true);
        } else if (data.enabled && end && now > end) {
          // Exam period has ended, reset to normal mode
          await AsyncStorage.setItem(EXAM_MODE_KEY, JSON.stringify({ ...data, enabled: false }));
          setIsExamMode(false);
          Alert.alert("Exam Period Ended", "Switched back to regular timetable.");
        } else {
          setIsExamMode(false);
        }
      }
    } catch (e) {
      console.warn("Failed checking exam mode status", e);
    }
  }

  async function persist(next, isExam = false) {
    if (isExam) {
      setExamEntries(next);
      try { await AsyncStorage.setItem(EXAM_ENTRIES_KEY, JSON.stringify(next)); } catch {}
    } else {
      setEntries(next);
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    }
  }

  async function scheduleEntry(e) {
    try {
      const startParsed = parseTimeToHM(e.startTime);
      const endParsed = parseTimeToHM(e.endTime);
      if (!startParsed || !endParsed) throw new Error("Invalid time format");
      
      const leadMin = Math.max(0, Number(e.lead || 0));
      const adj = adjustForLead(e.weekday, startParsed.hour, startParsed.minute, leadMin);
      
      // Calculate class duration
      let durationMin = (endParsed.hour * 60 + endParsed.minute) - (startParsed.hour * 60 + startParsed.minute);
      if (durationMin < 0) durationMin += 24 * 60; // Handle overnight classes

      let now = new Date();
      let nextClass = new Date(now);
      let todayWeekday = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
      let daysUntil = (e.weekday - todayWeekday + 7) % 7;
      // If same day but time has passed, schedule for next week
      if (daysUntil === 0 && (startParsed.hour < now.getHours() || (startParsed.hour === now.getHours() && startParsed.minute <= now.getMinutes()))) {
        daysUntil = 7;
      }
      nextClass.setDate(now.getDate() + daysUntil);
      nextClass.setHours(startParsed.hour, startParsed.minute, 0, 0);
      let diffMin = Math.round((nextClass - now) / 60000);
      if (diffMin < 0) diffMin += 10080;

      // Schedule pre-class notification
      const preClassTrigger = {
        channelId: Platform.OS === "android" ? "classes" : undefined,
        repeats: true,
        weekday: adj.weekday,
        hour: adj.hour,
        minute: adj.minute,
      };

      const preNotifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `${e.subject} starting in ${leadMin} minutes`,
          body: `Class from ${e.startTime} to ${e.endTime} — get ready!`,
          sound: true,
        },
        trigger: preClassTrigger,
      });

      // Schedule class started notification
      const startTrigger = {
        channelId: Platform.OS === "android" ? "classes" : undefined,
        repeats: true,
        weekday: e.weekday,
        hour: startParsed.hour,
        minute: startParsed.minute,
      };

      const startNotifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `${e.subject} has started!`,
          body: `Class runs until ${e.endTime} — ${durationMin} minutes remaining`,
          sound: true,
        },
        trigger: startTrigger,
      });

      return [preNotifId, startNotifId];
    } catch (error) {
      console.warn("Notification scheduling warning:", error.message);
      // Return a placeholder ID so app continues to function
      return `placeholder_${Date.now()}`;
    }
  }

  function generateExamSchedule() {
    if (!examStartDate || !examEndDate || !examTitle || !subject || !examStartTime) {
      return Alert.alert("Missing Information", "Please fill in exam title, subject, start date, end date, and start time.");
    }

    const parseDate = (dateStr) => {
      const [day, month, year] = dateStr.split('/');
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    };

    // Parse start time to get base hour and minute
    const startTimeParsed = parseTimeToHM(examStartTime);
    if (!startTimeParsed) {
      return Alert.alert("Invalid Start Time", "Please enter a valid start time (e.g., 9:00 AM).");
    }
    const baseStartHour = startTimeParsed.hour;
    const baseStartMinute = startTimeParsed.minute;

    const start = parseDate(examStartDate);
    const end = parseDate(examEndDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const perDay = parseInt(examsPerDay);
    const duration = parseInt(examDuration);
    const gap = parseInt(examGap);

    const entries = [];
    let currentDate = new Date(start);

    for (let day = 0; day < totalDays; day++) {
      for (let examNum = 0; examNum < perDay; examNum++) {
        const totalMinutesOffset = examNum * (duration * 60 + gap);
        const startHour = baseStartHour + Math.floor((baseStartMinute + totalMinutesOffset) / 60);
        const startMinute = (baseStartMinute + totalMinutesOffset) % 60;
        const endHour = startHour + Math.floor((duration * 60 + startMinute) / 60);
        const endMinute = (startMinute + (duration * 60)) % 60;

        const startTimeStr = formatTimeTo12Hour(`${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`);
        const endTimeStr = formatTimeTo12Hour(`${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`);

        const entry = {
          id: Date.now() + day * 1000 + examNum,
          subject: `${examTitle} - ${subject}`,
          startTime: startTimeStr,
          endTime: endTimeStr,
          weekday: currentDate.getDay(),
          lead: parseInt(lead),
          examDate: formatDateToDDMMYYYY(currentDate)
        };

        entries.push(entry);
        scheduleNotification(entry);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Save generated entries
    const updatedEntries = [...(examMode ? examEntries : currentEntries), ...entries];
    if (examMode) {
      setExamEntries(updatedEntries);
      AsyncStorage.setItem(EXAM_ENTRIES_KEY, JSON.stringify(updatedEntries));
    } else {
      setCurrentEntries(updatedEntries);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
    }

    // Reset form
    setExamTitle("");
    setSubject("");
    setExamStartDate("");
    setExamEndDate("");
    setShowExamScheduleModal(false);
    
    Alert.alert("Success", `Generated ${entries.length} exam entries!`);
  }

  async function addEntry() {
    const startParsed = parseTimeToHM(startTime);
    const endParsed = parseTimeToHM(endTime);
    if (!subject.trim()) return Alert.alert("Subject required", "Give this class a name.");
    if (!startParsed) return Alert.alert("Time format", "Use 12-hour format (e.g., 9:00 AM, 2:30 PM) for start time");
    if (!endParsed) return Alert.alert("Time format", "Use 12-hour format (e.g., 9:00 AM, 2:30 PM) for end time");
    
    // Validate time range
    const startMinutes = startParsed.hour * 60 + startParsed.minute;
    const endMinutes = endParsed.hour * 60 + endParsed.minute;
    if (endMinutes <= startMinutes) {
      return Alert.alert("Invalid time range", "End time must be after start time");
    }

    const newEntry = {
      id: Date.now().toString(),
      subject: subject.trim(),
      weekday,
      startTime: formatTimeTo12Hour(startParsed.hour, startParsed.minute),
      endTime: formatTimeTo12Hour(endParsed.hour, endParsed.minute),
      lead: String(Math.max(0, Number(lead || 0))),
      notifId: null,
    };
    try {
      const notifId = await scheduleEntry(newEntry);
      newEntry.notifId = notifId;
      const currentEntries = examMode ? examEntries : entries;
      const next = [newEntry, ...currentEntries].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
      await persist(next, examMode);
      setSubject("");
    } catch (e) {
      Alert.alert("Scheduling failed", e?.message || "Could not schedule notification.");
    }
  }

  async function removeEntry(id) {
    const currentEntries = examMode ? examEntries : entries;
    const found = currentEntries.find(e => e.id === id);
    const next = currentEntries.filter(e => e.id !== id);
    try {
      if (found?.notifId) {
        if (Array.isArray(found.notifId)) {
          // Cancel multiple notifications
          for (const notifId of found.notifId) {
            await Notifications.cancelScheduledNotificationAsync(notifId);
          }
        } else {
          // Cancel single notification (backwards compatibility)
          await Notifications.cancelScheduledNotificationAsync(found.notifId);
        }
      }
    } catch {}
    await persist(next, examMode);
  }

  async function rescheduleAll() {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const s of scheduled) {
        try { await Notifications.cancelScheduledNotificationAsync(s.identifier); } catch {}
      }
      const currentEntries = examMode ? examEntries : entries;
      const updated = [];
      for (const e of currentEntries) {
        const notifId = await scheduleEntry(e);
        updated.push({ ...e, notifId });
      }
      await persist(updated, examMode);
      Alert.alert("Updated", "All class reminders have been refreshed.");
    } catch (e) {
      console.warn("Reschedule warning:", e.message);
      Alert.alert("Notice", "Schedules updated. For full notification functionality, use a development build.");
    }
  }

  async function toggleExamMode() {
    if (!examMode && (!examStartDate || !examEndDate)) {
      return Alert.alert("Dates Required", "Please set exam start and end dates first.");
    }
    
    const newExamMode = !examMode;
    setExamMode(newExamMode);
    
    try {
      await AsyncStorage.setItem(EXAM_MODE_KEY, JSON.stringify({
        enabled: newExamMode,
        startDate: examStartDate,
        endDate: examEndDate
      }));
      
      if (newExamMode) {
        const now = new Date();
        
        // Parse DD/MM/YYYY date format
        const parseExamDate = (dateStr) => {
          if (!dateStr || !dateStr.includes('/')) return null;
          const [day, month, year] = dateStr.split('/');
          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        };
        
        const start = parseExamDate(examStartDate);
        const end = parseExamDate(examEndDate);
        
        if (start && end && start <= now && now <= end) {
          Alert.alert("Exam Mode Activated", "Now using exam timetable.");
        } else {
          Alert.alert("Exam Mode Set", "Will activate automatically when exam period starts.");
        }
      } else {
        Alert.alert("Exam Mode Deactivated", "Back to regular timetable.");
      }
      
      // Reschedule notifications
      await rescheduleAll();
    } catch (e) {
      Alert.alert("Error", "Failed to toggle exam mode.");
    }
  }

  // Template management functions
  async function saveExamTitleTemplate() {
    if (!examTitle.trim()) return;
    const currentTemplates = examTitleTemplates;
    const setCurrentTemplates = setExamTitleTemplates;
    
    if (!currentTemplates.includes(examTitle.trim())) {
      const updated = [...currentTemplates, examTitle.trim()];
      setCurrentTemplates(updated);
      await AsyncStorage.setItem(EXAM_TITLE_TEMPLATES_KEY, JSON.stringify(updated));
    }
  }

  async function saveExamScheduleTemplate() {
    if (!examsPerDay || !examDuration || !examGap || !examStartTime) return;
    
    const templateName = `Custom ${examsPerDay}x${examDuration}h`;
    const newTemplate = {
      name: templateName,
      duration: examDuration,
      examsPerDay: examsPerDay,
      gap: examGap,
      startTime: examStartTime
    };
    
    const currentTemplates = examScheduleTemplates;
    const existingIndex = currentTemplates.findIndex(t => t.name === templateName);
    
    let updated;
    if (existingIndex >= 0) {
      updated = [...currentTemplates];
      updated[existingIndex] = newTemplate;
    } else {
      updated = [...currentTemplates, newTemplate];
    }
    
    setExamScheduleTemplates(updated);
    await AsyncStorage.setItem(EXAM_SCHEDULE_TEMPLATES_KEY, JSON.stringify(updated));
    Alert.alert("Template Saved", `"${templateName}" schedule template saved!`);
  }

  async function saveSubjectTemplate() {
    if (!newTemplate.trim()) return;
    const templateKey = examMode ? EXAM_SUBJECT_TEMPLATES_KEY : SUBJECT_TEMPLATES_KEY;
    const currentTemplates = examMode ? examSubjectTemplates : subjectTemplates;
    const setCurrentTemplates = examMode ? setExamSubjectTemplates : setSubjectTemplates;
    
    const updated = [...currentTemplates, newTemplate.trim()];
    setCurrentTemplates(updated);
    await AsyncStorage.setItem(templateKey, JSON.stringify(updated));
    setNewTemplate("");
    if (examMode) {
      setShowExamSubjectModal(false);
    } else {
      setShowSubjectModal(false);
    }
  }

  async function saveTimeTemplate() {
    if (!startTime || !endTime) return;
    const template = { startTime, endTime, name: newTemplate.trim() || `${startTime} - ${endTime}` };
    const templateKey = examMode ? EXAM_TIME_TEMPLATES_KEY : TIME_TEMPLATES_KEY;
    const currentTemplates = examMode ? examTimeTemplates : timeTemplates;
    const setCurrentTemplates = examMode ? setExamTimeTemplates : setTimeTemplates;
    
    const updated = [...currentTemplates, template];
    setCurrentTemplates(updated);
    await AsyncStorage.setItem(templateKey, JSON.stringify(updated));
    setNewTemplate("");
    if (examMode) {
      setShowExamTimeModal(false);
    } else {
      setShowTimeModal(false);
    }
  }

  function applyTimeTemplate(template) {
    setStartTime(template.startTime);
    setEndTime(template.endTime);
    
    // Also update the date objects for the pickers
    const startParsed = parseTimeToHM(template.startTime);
    const endParsed = parseTimeToHM(template.endTime);
    
    if (startParsed) {
      const newStartDate = new Date();
      newStartDate.setHours(startParsed.hour, startParsed.minute, 0, 0);
      setStartTimeDate(newStartDate);
    }
    
    if (endParsed) {
      const newEndDate = new Date();
      newEndDate.setHours(endParsed.hour, endParsed.minute, 0, 0);
      setEndTimeDate(newEndDate);
    }
  }

  // Helper functions for date and time formatting
  const formatTime = (date) => {
    const hour = date.getHours();
    const minute = date.getMinutes();
    return formatTimeTo12Hour(hour, minute);
  };

  const formatDate = (date) => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Auto-format time input (H:MM AM/PM)
  const formatTimeInput = (text) => {
    // Remove everything except numbers, colon, A, M, P
    const cleaned = text.replace(/[^0-9:APMapm\s]/g, '').toUpperCase();
    
    // If user is typing AM or PM, allow it
    if (cleaned.includes('A') || cleaned.includes('P')) {
      return cleaned;
    }
    
    // Format numbers with colon
    const numbersOnly = cleaned.replace(/[^0-9]/g, '');
    if (numbersOnly.length <= 1) {
      return numbersOnly;
    } else if (numbersOnly.length <= 2) {
      return numbersOnly;
    } else if (numbersOnly.length <= 4) {
      return numbersOnly.slice(0, numbersOnly.length <= 2 ? 2 : -2) + ':' + numbersOnly.slice(-2);
    }
    return numbersOnly.slice(0, 2) + ':' + numbersOnly.slice(2, 4);
  };

  // Auto-format date input (DD/MM/YYYY)
  const formatDateInput = (text) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned.length <= 2) {
      return cleaned;
    } else if (cleaned.length <= 4) {
      return cleaned.slice(0, 2) + '/' + cleaned.slice(2);
    } else if (cleaned.length <= 8) {
      return cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4) + '/' + cleaned.slice(4);
    }
    return cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4) + '/' + cleaned.slice(4, 8);
  };

  // Time picker handlers
  const onStartTimeChange = (event, selectedTime) => {
    setShowStartTimePicker(false);
    if (selectedTime) {
      setStartTimeDate(selectedTime);
      setStartTime(formatTime(selectedTime));
    }
  };

  const onEndTimeChange = (event, selectedTime) => {
    setShowEndTimePicker(false);
    if (selectedTime) {
      setEndTimeDate(selectedTime);
      setEndTime(formatTime(selectedTime));
    }
  };

  // Date picker handlers
  const onExamStartDateChange = (event, selectedDate) => {
    setShowStartDatePicker(false);
    if (selectedDate) {
      setExamStartDateObj(selectedDate);
      setExamStartDate(formatDate(selectedDate));
    }
  };

  const onExamEndDateChange = (event, selectedDate) => {
    setShowEndDatePicker(false);
    if (selectedDate) {
      setExamEndDateObj(selectedDate);
      setExamEndDate(formatDate(selectedDate));
    }
  };

  // Timetable helper functions
  const getDayName = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  };

  const getShortDayName = (date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  const getWeekdayNumber = (date) => {
  return date.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  };

  const formatDateString = (date) => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month}`;
  };

  const isToday = (date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const navigateDay = (direction) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + direction);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  // Check if a class is currently active
  const isClassActive = (startTime, endTime) => {
    if (!isToday(selectedDate)) return false;
    
    const now = currentTime;
    const startParsed = parseTimeToHM(startTime);
    const endParsed = parseTimeToHM(endTime);
    
    if (!startParsed || !endParsed) return false;
    
    const classStart = new Date();
    classStart.setHours(startParsed.hour, startParsed.minute, 0, 0);
    
    const classEnd = new Date();
    classEnd.setHours(endParsed.hour, endParsed.minute, 0, 0);
    
    return now >= classStart && now <= classEnd;
  };

  // Get classes for the selected day
  const getSelectedDayClasses = () => {
    const currentEntries = isExamMode ? examEntries : entries;
    const weekdayNum = getWeekdayNumber(selectedDate);
    return currentEntries.filter(e => e.weekday === weekdayNum)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  };

  const grouped = useMemo(() => {
    const currentEntries = isExamMode ? examEntries : entries;
    const g = {};
    for (const d of DAYS) g[d.value] = [];
    for (const e of currentEntries) g[e.weekday]?.push(e);
    for (const k in g) g[k].sort((a, b) => a.startTime.localeCompare(b.startTime));
    return g;
  }, [entries, examEntries, isExamMode]);

  function DaySelector({ value, onChange }) {
    return (
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {DAYS.map((d) => (
          <Pressable
            key={d.value}
            onPress={() => onChange(d.value)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: value === d.value ? COLORS.primary : COLORS.surfaceVariant,
              borderWidth: 1,
              borderColor: value === d.value ? COLORS.primary : COLORS.border,
            }}
          >
            <Text style={{ 
              color: value === d.value ? COLORS.onSurface : COLORS.onSurfaceVariant, 
              fontWeight: "600" 
            }}>
              {d.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function EntryRow({ e }) {
    const dayLabel = DAYS.find(d => d.value === e.weekday)?.label || "?";
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 16,
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: COLORS.border,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: COLORS.onSurface, marginBottom: 4 }}>
            {e.subject}
          </Text>
          <Text style={{ color: COLORS.onSurfaceVariant, fontWeight: "500", fontSize: 13 }}>
            {dayLabel} • {e.startTime} - {e.endTime}
          </Text>
          <Text style={{ color: COLORS.accent, fontWeight: "500", fontSize: 12, marginTop: 2 }}>
            Notify {e.lead.toString()} min before start
          </Text>
        </View>
        <Pressable 
          onPress={() => removeEntry(e.id)} 
          style={{ 
            padding: 8, 
            backgroundColor: COLORS.error + "20", 
            borderRadius: 8 
          }}
        >
          <Text style={{ color: COLORS.error, fontWeight: "700", fontSize: 13 }}>Delete</Text>
        </Pressable>
      </View>
    );
  }

  // New Timetable Components
  function TimetableHeader() {
    return (
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
        paddingHorizontal: 4
      }}>
        <Pressable 
          onPress={() => navigateDay(-1)}
          style={{
            padding: 12,
            backgroundColor: COLORS.primary + "20",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.primary + "40"
          }}
        >
          <MaterialIcons name="chevron-left" size={20} color={COLORS.primary} />
        </Pressable>
        
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", color: COLORS.onSurface }}>
            {getDayName(selectedDate)}
          </Text>
          <Text style={{ fontSize: 14, color: COLORS.onSurfaceVariant }}>
            {formatDateString(selectedDate)}
          </Text>
          {isToday(selectedDate) && (
            <View style={{
              backgroundColor: COLORS.accent + "20",
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 8,
              marginTop: 4
            }}>
              <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: "600" }}>TODAY</Text>
            </View>
          )}
        </View>
        
        <Pressable 
          onPress={() => navigateDay(1)}
          style={{
            padding: 12,
            backgroundColor: COLORS.primary + "20",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.primary + "40"
          }}
        >
          <MaterialIcons name="chevron-right" size={20} color={COLORS.primary} />
        </Pressable>
      </View>
    );
  }

  function TimetableClass({ classItem }) {
    const isActive = isClassActive(classItem.startTime, classItem.endTime);
    
    return (
      <View
        style={{
          backgroundColor: isActive ? COLORS.primary + "10" : "transparent",
          borderRadius: 16,
          padding: 16,
          marginBottom: 12,
          borderWidth: isActive ? 2 : 1,
          borderColor: isActive ? COLORS.primary : COLORS.border + "30",
          borderLeftWidth: 6,
          borderLeftColor: isActive ? COLORS.accent : COLORS.primary,
          shadowColor: isActive ? COLORS.primary : "transparent",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isActive ? 0.3 : 0,
          shadowRadius: 4,
          elevation: isActive ? 4 : 0,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontSize: 18,
              fontWeight: "800",
              color: isActive ? COLORS.primary : COLORS.onSurface,
              marginBottom: 6
            }}>
              {classItem.subject}
            </Text>
            
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <View style={{
                backgroundColor: isActive ? COLORS.accent + "30" : COLORS.primary + "20",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
                marginRight: 8
              }}>
                <Text style={{
                  color: isActive ? COLORS.accent : COLORS.primary,
                  fontSize: 14,
                  fontWeight: "700"
                }}>
                  {classItem.startTime}
                </Text>
              </View>
              <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 14, marginRight: 8 }}>to</Text>
              <View style={{
                backgroundColor: isActive ? COLORS.accent + "30" : COLORS.primary + "20",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12
              }}>
                <Text style={{
                  color: isActive ? COLORS.accent : COLORS.primary,
                  fontSize: 14,
                  fontWeight: "700"
                }}>
                  {classItem.endTime}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <MaterialIcons name="notifications" size={14} color={COLORS.onSurfaceVariant} />
              <Text style={{ 
                color: COLORS.onSurfaceVariant, 
                fontSize: 12,
                fontStyle: "italic",
                marginLeft: 4
              }}>
                Reminder {classItem.lead.toString()} min before
              </Text>
            </View>
            
            {isActive && (
              <View style={{
                backgroundColor: COLORS.accent + "20",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                alignSelf: "flex-start",
                marginTop: 8,
                flexDirection: "row",
                alignItems: "center"
              }}>
                <MaterialIcons name="fiber-manual-record" size={12} color={COLORS.accent} />
                <Text style={{
                  color: COLORS.accent,
                  fontSize: 11,
                  fontWeight: "700",
                  marginLeft: 4
                }}>
                  LIVE NOW
                </Text>
              </View>
            )}
          </View>
          
          <Pressable 
            onPress={() => removeEntry(classItem.id)} 
            style={{ 
              padding: 8, 
              backgroundColor: COLORS.error + "15", 
              borderRadius: 10,
              marginLeft: 12
            }}
          >
            <MaterialIcons name="close" size={14} color={COLORS.error} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView 
          contentContainerStyle={{ padding: 16 }} 
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Exam Mode Status */}
          {isExamMode && (
            <View style={{ 
              backgroundColor: COLORS.warning + "20", 
              padding: 12, 
              borderRadius: 12, 
              marginBottom: 16, 
              borderLeftWidth: 4, 
              borderLeftColor: COLORS.warning 
            }}>
              <Text style={{ color: COLORS.warning, fontWeight: "600" }}>▶ Exam Mode Active</Text>
              <Text style={{ color: COLORS.warning, fontSize: 13 }}>Using exam timetable until {examEndDate}</Text>
            </View>
          )}

          {/* Add Class Form */}
          <View style={{ 
            backgroundColor: COLORS.surface, 
            padding: 18, 
            borderRadius: 16, 
            marginBottom: 16, 
            borderWidth: 1, 
            borderColor: COLORS.border 
          }}>
            <Text style={{ fontWeight: "700", marginBottom: 16, fontSize: 18, color: COLORS.onSurface }}>
              Add Class
            </Text>
            
            {/* Subject Input with Template */}
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ fontWeight: "600", fontSize: 14, color: COLORS.onSurface }}>Subject</Text>
                <Pressable 
                  onPress={() => examMode ? setShowExamSubjectModal(true) : setShowSubjectModal(true)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.primary + "20", borderRadius: 8 }}
                >
                  <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "600" }}>Templates</Text>
                </Pressable>
              </View>
              <TextInput
                placeholder="e.g., Data Structures, Mathematics..."
                placeholderTextColor={COLORS.onSurfaceVariant}
                value={subject}
                onChangeText={setSubject}
                style={{ 
                  backgroundColor: "#111111", // Subtle dark background for visibility
                  padding: 14, 
                  borderRadius: 12, 
                  fontSize: 15,
                  color: COLORS.onSurface,
                  borderWidth: 1,
                  borderColor: COLORS.border
                }}
              />
            </View>

            <DaySelector value={weekday} onChange={setWeekday} />

            {/* Time Range with Template */}
            <View style={{ marginTop: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ fontWeight: "600", fontSize: 14, color: COLORS.onSurface }}>Time Range</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable 
                    onPress={() => setUseTimePicker(!useTimePicker)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: COLORS.accent + "20", borderRadius: 6 }}
                  >
                    <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: "600" }}>
                      {useTimePicker ? "Manual" : "Picker"}
                    </Text>
                  </Pressable>
                  <Pressable 
                    onPress={() => examMode ? setShowExamTimeModal(true) : setShowTimeModal(true)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.primary + "20", borderRadius: 8 }}
                  >
                    <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "600" }}>Templates</Text>
                  </Pressable>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ marginBottom: 6, fontWeight: "600", fontSize: 13, color: COLORS.onSurfaceVariant }}>From</Text>
                  {useTimePicker ? (
                    <Pressable
                      onPress={() => setShowStartTimePicker(true)}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 14, 
                        borderRadius: 12, 
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{ 
                        color: startTime ? COLORS.onSurface : COLORS.onSurfaceVariant, 
                        fontSize: 15 
                      }}>
                        {startTime || "9:00 AM"}
                      </Text>
                    </Pressable>
                  ) : (
                    <TextInput
                      placeholder="9:00 AM"
                      placeholderTextColor={COLORS.onSurfaceVariant}
                      keyboardType="numeric"
                      value={startTime}
                      onChangeText={(text) => setStartTime(formatTimeInput(text))}
                      maxLength={5}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 14, 
                        borderRadius: 12, 
                        fontSize: 15,
                        color: COLORS.onSurface,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ marginBottom: 6, fontWeight: "600", fontSize: 13, color: COLORS.onSurfaceVariant }}>To</Text>
                  {useTimePicker ? (
                    <Pressable
                      onPress={() => setShowEndTimePicker(true)}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 14, 
                        borderRadius: 12, 
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{ 
                        color: endTime ? COLORS.onSurface : COLORS.onSurfaceVariant, 
                        fontSize: 15 
                      }}>
                        {endTime || "10:00 AM"}
                      </Text>
                    </Pressable>
                  ) : (
                    <TextInput
                      placeholder="10:00 AM"
                      placeholderTextColor={COLORS.onSurfaceVariant}
                      keyboardType="numeric"
                      value={endTime}
                      onChangeText={(text) => setEndTime(formatTimeInput(text))}
                      maxLength={5}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 14, 
                        borderRadius: 12, 
                        fontSize: 15,
                        color: COLORS.onSurface,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    />
                  )}
                </View>
                <View style={{ width: 100 }}>
                  <Text style={{ marginBottom: 6, fontWeight: "600", fontSize: 13, color: COLORS.onSurfaceVariant }}>
                    Lead (min)
                  </Text>
                  <TextInput
                    placeholder="10"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    keyboardType="numeric"
                    value={lead}
                    onChangeText={setLead}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 14, 
                      borderRadius: 12, 
                      fontSize: 15,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                </View>
              </View>
            </View>

            <Pressable 
              onPress={addEntry} 
              style={{ 
                marginTop: 20, 
                backgroundColor: COLORS.primary, 
                padding: 16, 
                borderRadius: 12, 
                alignItems: "center" 
              }}
            >
              <Text style={{ color: COLORS.onSurface, fontWeight: "800", fontSize: 16 }}>
                Add to {examMode ? "Exam" : "Regular"} Schedule
              </Text>
            </Pressable>

            {examMode && (
              <Pressable 
                onPress={() => setShowExamScheduleModal(true)} 
                style={{ 
                  marginTop: 12, 
                  backgroundColor: COLORS.accent + "20", 
                  padding: 16, 
                  borderRadius: 12, 
                  alignItems: "center",
                  borderWidth: 2,
                  borderColor: COLORS.accent + "40",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8
                }}
              >
                <MaterialIcons name="auto-awesome" size={20} color={COLORS.accent} />
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: COLORS.accent, fontWeight: "800", fontSize: 16 }}>
                    Generate Full Exam Schedule
                  </Text>
                  <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 12, marginTop: 4 }}>
                    Auto-schedule multiple exams with time slots
                  </Text>
                </View>
              </Pressable>
            )}

            <Pressable 
              onPress={rescheduleAll} 
              style={{ 
                marginTop: 10, 
                backgroundColor: COLORS.surfaceVariant, 
                padding: 14, 
                borderRadius: 12, 
                alignItems: "center",
                borderWidth: 1,
                borderColor: COLORS.border
              }}
            >
              <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 15 }}>Refresh All Notifications</Text>
            </Pressable>
          </View>

          {/* Exam Mode Controls */}
          <View style={{ 
            backgroundColor: COLORS.surface, 
            padding: 18, 
            borderRadius: 16, 
            marginBottom: 16, 
            borderWidth: 1, 
            borderColor: COLORS.border 
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontWeight: "700", fontSize: 16, color: COLORS.onSurface }}>Exam Mode</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Pressable 
                  onPress={() => setUseDatePicker(!useDatePicker)}
                  style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: COLORS.accent + "20", borderRadius: 6 }}
                >
                  <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: "600" }}>
                    {useDatePicker ? "Manual" : "Picker"}
                  </Text>
                </Pressable>
                <Switch
                  value={examMode}
                  onValueChange={toggleExamMode}
                  trackColor={{ false: COLORS.surfaceVariant, true: COLORS.primary }}
                  thumbColor={examMode ? COLORS.onSurface : COLORS.onSurfaceVariant}
                />
              </View>
            </View>
            
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ marginBottom: 7, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Start Date</Text>
                {useDatePicker ? (
                  <Pressable
                    onPress={() => setShowStartDatePicker(true)}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 14, 
                      borderRadius: 12, 
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      justifyContent: 'center'
                    }}
                  >
                    <Text style={{ 
                      color: examStartDate ? COLORS.onSurface : COLORS.onSurfaceVariant, 
                      fontSize: 15 
                    }}>
                      {examStartDate || "15/12/2025"}
                    </Text>
                  </Pressable>
                ) : (
                  <TextInput
                    placeholder="15/12/2025"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    keyboardType="numeric"
                    value={examStartDate}
                    onChangeText={(text) => setExamStartDate(formatDateInput(text))}
                    maxLength={10}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 14, 
                      borderRadius: 12, 
                      fontSize: 15,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ marginBottom: 7, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>End Date</Text>
                {useDatePicker ? (
                  <Pressable
                    onPress={() => setShowEndDatePicker(true)}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 14, 
                      borderRadius: 12, 
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      justifyContent: 'center'
                    }}
                  >
                    <Text style={{ 
                      color: examEndDate ? COLORS.onSurface : COLORS.onSurfaceVariant, 
                      fontSize: 15 
                    }}>
                      {examEndDate || "22/12/2025"}
                    </Text>
                  </Pressable>
                ) : (
                  <TextInput
                    placeholder="22/12/2025"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    keyboardType="numeric"
                    value={examEndDate}
                    onChangeText={(text) => setExamEndDate(formatDateInput(text))}
                    maxLength={10}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 14, 
                      borderRadius: 12, 
                      fontSize: 15,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                )}
              </View>
            </View>
            <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 12, marginTop: 8 }}>
              Schedule will auto-switch during exam period and return to normal afterwards.
            </Text>
          </View>

          <View style={{
            backgroundColor: "transparent",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: COLORS.border + "20"
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {isExamMode ? (
                  <MaterialCommunityIcons name="book-education" size={20} color={COLORS.accent} />
                ) : (
                  <MaterialIcons name="schedule" size={20} color={COLORS.accent} />
                )}
                <Text style={{ fontWeight: "800", fontSize: 18, color: COLORS.onSurface, marginLeft: 8 }}>
                  {isExamMode ? "Exam Timetable" : "Class Timetable"}
                </Text>
              </View>
              <Pressable 
                onPress={goToToday}
                style={{
                  backgroundColor: COLORS.accent + "20",
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8
                }}
              >
                <Text style={{ color: COLORS.accent, fontSize: 12, fontWeight: "600" }}>Today</Text>
              </Pressable>
            </View>
            
            <TimetableHeader />
            
            <View style={{ minHeight: 200 }}>
              {(() => {
                const dayClasses = getSelectedDayClasses();
                if (dayClasses.length > 0) {
                  return dayClasses.map((classItem) => (
                    <TimetableClass key={classItem.id} classItem={classItem} />
                  ));
                } else {
                  return (
                    <View style={{
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 40,
                      borderRadius: 12,
                      backgroundColor: "transparent"
                    }}>
                      <MaterialIcons name="event-busy" size={32} color={COLORS.onSurfaceVariant} style={{ marginBottom: 12 }} />
                      <Text style={{ 
                        color: COLORS.onSurfaceVariant, 
                        fontSize: 16, 
                        fontStyle: "italic",
                        marginBottom: 8 
                      }}>
                        No classes scheduled
                      </Text>
                      <Text style={{ 
                        color: COLORS.onSurfaceVariant, 
                        fontSize: 13,
                        textAlign: "center"
                      }}>
                        for {getDayName(selectedDate)}
                      </Text>
                    </View>
                  );
                }
              })()}
            </View>
            
            {/* Week Navigation */}
            <View style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 16,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: COLORS.border
            }}>
              {(() => {
                const weekDays = [];
                const startOfWeek = new Date(selectedDate);
                const day = startOfWeek.getDay();
                const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
                startOfWeek.setDate(diff);
                
                for (let i = 0; i < 7; i++) {
                  const currentDay = new Date(startOfWeek);
                  currentDay.setDate(startOfWeek.getDate() + i);
                  weekDays.push(currentDay);
                }
                
                return weekDays.map((day, index) => {
                  const isSelected = day.toDateString() === selectedDate.toDateString();
                  const isDayToday = isToday(day);
                  
                  return (
                    <Pressable
                      key={index}
                      onPress={() => setSelectedDate(new Date(day))}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        paddingVertical: 8,
                        paddingHorizontal: 4,
                        borderRadius: 8,
                        backgroundColor: isSelected ? COLORS.primary : "transparent",
                        borderWidth: isDayToday ? 1 : 0,
                        borderColor: isDayToday ? COLORS.accent : "transparent"
                      }}
                    >
                      <Text style={{
                        color: isSelected ? COLORS.onSurface : COLORS.onSurfaceVariant,
                        fontSize: 10,
                        fontWeight: "600",
                        marginBottom: 4
                      }}>
                        {getShortDayName(day)}
                      </Text>
                      <Text style={{
                        color: isSelected ? COLORS.onSurface : COLORS.onSurfaceVariant,
                        fontSize: 12,
                        fontWeight: isSelected ? "700" : "500"
                      }}>
                        {day.getDate().toString()}
                      </Text>
                    </Pressable>
                  );
                });
              })()}
            </View>
          </View>

          {/* Subject Templates Modal */}
          <Modal visible={showSubjectModal} transparent animationType="slide">
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" }}>
              <View style={{ 
                backgroundColor: COLORS.background, 
                borderTopLeftRadius: 20, 
                borderTopRightRadius: 20, 
                padding: 20, 
                maxHeight: "80%",
                borderWidth: 1,
                borderColor: COLORS.border + "30"
              }}>
                <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 16, color: COLORS.onSurface }}>
                  Regular Subject Templates
                </Text>
                <View style={{ flexDirection: "row", marginBottom: 16 }}>
                  <TextInput
                    placeholder="New subject template"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    value={newTemplate}
                    onChangeText={setNewTemplate}
                    style={{ 
                      flex: 1, 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 12, 
                      borderRadius: 8, 
                      marginRight: 8,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                  <Pressable 
                    onPress={saveSubjectTemplate}
                    style={{ backgroundColor: COLORS.primary, padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: COLORS.onSurface, fontWeight: "600" }}>Add</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {subjectTemplates.map((template, index) => (
                    <Pressable
                      key={index}
                      onPress={() => {
                        setSubject(template);
                        setShowSubjectModal(false);
                      }}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 12, 
                        borderRadius: 8, 
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    >
                      <Text style={{ color: COLORS.onSurface }}>{template}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable 
                  onPress={() => setShowSubjectModal(false)}
                  style={{ marginTop: 16, padding: 12, backgroundColor: COLORS.surfaceVariant, borderRadius: 8 }}
                >
                  <Text style={{ color: COLORS.onSurface, textAlign: "center", fontWeight: "600" }}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* Exam Subject Templates Modal */}
          <Modal visible={showExamSubjectModal} transparent animationType="slide">
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
              <View style={{ 
                backgroundColor: COLORS.surface, 
                borderTopLeftRadius: 20, 
                borderTopRightRadius: 20, 
                padding: 20, 
                maxHeight: "80%" 
              }}>
                <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 16, color: COLORS.onSurface }}>
                  Exam Subject Templates
                </Text>
                <View style={{ flexDirection: "row", marginBottom: 16 }}>
                  <TextInput
                    placeholder="New exam subject template"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    value={newTemplate}
                    onChangeText={setNewTemplate}
                    style={{ 
                      flex: 1, 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 12, 
                      borderRadius: 8, 
                      marginRight: 8,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                  <Pressable 
                    onPress={saveSubjectTemplate}
                    style={{ backgroundColor: COLORS.primary, padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: COLORS.onSurface, fontWeight: "600" }}>Add</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {examSubjectTemplates.map((template, index) => (
                    <Pressable
                      key={index}
                      onPress={() => {
                        setSubject(template);
                        setShowExamSubjectModal(false);
                      }}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 12, 
                        borderRadius: 8, 
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    >
                      <Text style={{ color: COLORS.onSurface }}>{template}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable 
                  onPress={() => setShowExamSubjectModal(false)}
                  style={{ marginTop: 16, padding: 12, backgroundColor: COLORS.surfaceVariant, borderRadius: 8 }}
                >
                  <Text style={{ color: COLORS.onSurface, textAlign: "center", fontWeight: "600" }}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* Time Templates Modal */}
          <Modal visible={showTimeModal} transparent animationType="slide">
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
              <View style={{ 
                backgroundColor: COLORS.surface, 
                borderTopLeftRadius: 20, 
                borderTopRightRadius: 20, 
                padding: 20, 
                maxHeight: "80%" 
              }}>
                <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 16, color: COLORS.onSurface }}>
                  Regular Time Templates
                </Text>
                <View style={{ marginBottom: 16 }}>
                  <TextInput
                    placeholder="Template name (optional)"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    value={newTemplate}
                    onChangeText={setNewTemplate}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 12, 
                      borderRadius: 8, 
                      marginBottom: 8,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                  <Pressable 
                    onPress={saveTimeTemplate}
                    style={{ backgroundColor: COLORS.primary, padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: COLORS.onSurface, fontWeight: "600", textAlign: "center" }}>
                      Save Current Time ({startTime} - {endTime})
                    </Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {timeTemplates.map((template, index) => (
                    <Pressable
                      key={index}
                      onPress={() => {
                        applyTimeTemplate(template);
                        setShowTimeModal(false);
                      }}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 12, 
                        borderRadius: 8, 
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    >
                      <Text style={{ color: COLORS.onSurface, fontWeight: "600" }}>{template.name}</Text>
                      <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 12 }}>
                        {template.startTime} - {template.endTime}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable 
                  onPress={() => setShowTimeModal(false)}
                  style={{ marginTop: 16, padding: 12, backgroundColor: COLORS.surfaceVariant, borderRadius: 8 }}
                >
                  <Text style={{ color: COLORS.onSurface, textAlign: "center", fontWeight: "600" }}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* Exam Time Templates Modal */}
          <Modal visible={showExamTimeModal} transparent animationType="slide">
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
              <View style={{ 
                backgroundColor: COLORS.surface, 
                borderTopLeftRadius: 20, 
                borderTopRightRadius: 20, 
                padding: 20, 
                maxHeight: "80%" 
              }}>
                <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 16, color: COLORS.onSurface }}>
                  Exam Time Templates
                </Text>
                <View style={{ marginBottom: 16 }}>
                  <TextInput
                    placeholder="Template name (optional)"
                    placeholderTextColor={COLORS.onSurfaceVariant}
                    value={newTemplate}
                    onChangeText={setNewTemplate}
                    style={{ 
                      backgroundColor: COLORS.surfaceVariant, 
                      padding: 12, 
                      borderRadius: 8, 
                      marginBottom: 8,
                      color: COLORS.onSurface,
                      borderWidth: 1,
                      borderColor: COLORS.border
                    }}
                  />
                  <Pressable 
                    onPress={saveTimeTemplate}
                    style={{ backgroundColor: COLORS.primary, padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: COLORS.onSurface, fontWeight: "600", textAlign: "center" }}>
                      Save Current Time ({startTime} - {endTime})
                    </Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {examTimeTemplates.map((template, index) => (
                    <Pressable
                      key={index}
                      onPress={() => {
                        applyTimeTemplate(template);
                        setShowExamTimeModal(false);
                      }}
                      style={{ 
                        backgroundColor: COLORS.surfaceVariant, 
                        padding: 12, 
                        borderRadius: 8, 
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    >
                      <Text style={{ color: COLORS.onSurface, fontWeight: "600" }}>{template.name}</Text>
                      <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 12 }}>
                        {template.startTime} - {template.endTime}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable 
                  onPress={() => setShowExamTimeModal(false)}
                  style={{ marginTop: 16, padding: 12, backgroundColor: COLORS.surfaceVariant, borderRadius: 8 }}
                >
                  <Text style={{ color: COLORS.onSurface, textAlign: "center", fontWeight: "600" }}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* Comprehensive Exam Schedule Modal */}
          <Modal visible={showExamScheduleModal} transparent animationType="slide">
            <View style={{ 
              flex: 1, 
              backgroundColor: "#000000", // Pure AMOLED black
              justifyContent: "center", 
              alignItems: "center",
              padding: 20
            }}>
              <View style={{ 
                backgroundColor: COLORS.surface, 
                padding: 24, 
                borderRadius: 16, 
                width: "100%",
                maxHeight: "90%"
              }}>
                <Text style={{ 
                  fontSize: 20, 
                  fontWeight: "800", 
                  color: COLORS.onSurface, 
                  marginBottom: 20,
                  textAlign: "center"
                }}>
                  Generate Exam Schedule
                </Text>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Exam Title */}
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ marginBottom: 8, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Exam Title</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                      <TextInput
                        placeholder="e.g., Midterm Exam"
                        placeholderTextColor={COLORS.onSurfaceVariant}
                        value={examTitle}
                        onChangeText={setExamTitle}
                        style={{ 
                          flex: 1,
                          backgroundColor: "#111111",
                          padding: 12, 
                          borderRadius: 8, 
                          fontSize: 14,
                          color: COLORS.onSurface,
                          borderWidth: 1,
                          borderColor: COLORS.border
                        }}
                      />
                      <Pressable 
                        onPress={() => {
                          // Template picker for exam titles
                          const titles = examTitleTemplates;
                          if (titles.length > 0) {
                            const randomTitle = titles[Math.floor(Math.random() * titles.length)];
                            setExamTitle(randomTitle);
                          }
                        }}
                        style={{ 
                          backgroundColor: COLORS.primary + "20", 
                          paddingHorizontal: 12, 
                          paddingVertical: 8, 
                          borderRadius: 8,
                          justifyContent: "center"
                        }}
                      >
                        <MaterialIcons name="shuffle" size={16} color={COLORS.primary} />
                      </Pressable>
                      <Pressable 
                        onPress={saveExamTitleTemplate}
                        style={{ 
                          backgroundColor: COLORS.accent + "20", 
                          paddingHorizontal: 12, 
                          paddingVertical: 8, 
                          borderRadius: 8,
                          justifyContent: "center"
                        }}
                      >
                        <MaterialIcons name="save" size={16} color={COLORS.accent} />
                      </Pressable>
                    </View>
                    {/* Quick exam title templates */}
                    {examTitleTemplates.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          {examTitleTemplates.map((template, index) => (
                            <Pressable
                              key={index}
                              onPress={() => setExamTitle(template)}
                              style={{ 
                                backgroundColor: examTitle === template ? COLORS.accent + "30" : COLORS.surfaceVariant, 
                                paddingHorizontal: 10, 
                                paddingVertical: 6, 
                                borderRadius: 6,
                                borderWidth: 1,
                                borderColor: examTitle === template ? COLORS.accent : COLORS.border
                              }}
                            >
                              <Text style={{ 
                                color: examTitle === template ? COLORS.accent : COLORS.onSurfaceVariant, 
                                fontSize: 12, 
                                fontWeight: examTitle === template ? "600" : "500"
                              }}>
                                {template}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    )}
                  </View>

                  {/* Subject */}
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ marginBottom: 8, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Subject</Text>
                    <TextInput
                      placeholder="e.g., Mathematics, Physics..."
                      placeholderTextColor={COLORS.onSurfaceVariant}
                      value={subject}
                      onChangeText={setSubject}
                      style={{ 
                        backgroundColor: "#111111",
                        padding: 12, 
                        borderRadius: 8, 
                        fontSize: 14,
                        color: COLORS.onSurface,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    />
                  </View>

                  {/* Date Range */}
                  <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ marginBottom: 8, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Start Date</Text>
                      <TextInput
                        placeholder="15/12/2025"
                        placeholderTextColor={COLORS.onSurfaceVariant}
                        keyboardType="numeric"
                        value={examStartDate}
                        onChangeText={(text) => setExamStartDate(formatDateInput(text))}
                        style={{ 
                          backgroundColor: "#111111",
                          padding: 12, 
                          borderRadius: 8, 
                          fontSize: 14,
                          color: COLORS.onSurface,
                          borderWidth: 1,
                          borderColor: COLORS.border
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ marginBottom: 8, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>End Date</Text>
                      <TextInput
                        placeholder="22/12/2025"
                        placeholderTextColor={COLORS.onSurfaceVariant}
                        keyboardType="numeric"
                        value={examEndDate}
                        onChangeText={(text) => setExamEndDate(formatDateInput(text))}
                        style={{ 
                          backgroundColor: "#111111",
                          padding: 12, 
                          borderRadius: 8, 
                          fontSize: 14,
                          color: COLORS.onSurface,
                          borderWidth: 1,
                          borderColor: COLORS.border
                        }}
                      />
                    </View>
                  </View>

                  {/* Start Time Setting */}
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ marginBottom: 8, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Daily Start Time</Text>
                    <TextInput
                      placeholder="9:00 AM"
                      placeholderTextColor={COLORS.onSurfaceVariant}
                      value={examStartTime}
                      onChangeText={setExamStartTime}
                      style={{ 
                        backgroundColor: "#111111",
                        padding: 12, 
                        borderRadius: 8, 
                        fontSize: 14,
                        color: COLORS.onSurface,
                        borderWidth: 1,
                        borderColor: COLORS.border
                      }}
                    />
                    <Text style={{ 
                      fontSize: 11, 
                      color: COLORS.onSurfaceVariant, 
                      marginTop: 4,
                      fontStyle: "italic" 
                    }}>
                      First exam will start at this time each day
                    </Text>
                  </View>

                  {/* Schedule Configuration */}
                  <View style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <Text style={{ fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Schedule Configuration</Text>
                      <Pressable 
                        onPress={saveExamScheduleTemplate}
                        style={{ 
                          backgroundColor: COLORS.accent + "20", 
                          paddingHorizontal: 8, 
                          paddingVertical: 4, 
                          borderRadius: 6,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4
                        }}
                      >
                        <MaterialIcons name="bookmark-add" size={12} color={COLORS.accent} />
                        <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: "600" }}>Save as Template</Text>
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ marginBottom: 8, fontWeight: "500", fontSize: 12, color: COLORS.onSurfaceVariant }}>Exams per Day</Text>
                        <TextInput
                          placeholder="1"
                          placeholderTextColor={COLORS.onSurfaceVariant}
                          keyboardType="numeric"
                          value={examsPerDay}
                          onChangeText={setExamsPerDay}
                          style={{ 
                            backgroundColor: "#111111",
                            padding: 12, 
                            borderRadius: 8, 
                            fontSize: 14,
                            color: COLORS.onSurface,
                            borderWidth: 1,
                            borderColor: COLORS.border
                          }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ marginBottom: 8, fontWeight: "500", fontSize: 12, color: COLORS.onSurfaceVariant }}>Duration (hrs)</Text>
                        <TextInput
                          placeholder="2"
                          placeholderTextColor={COLORS.onSurfaceVariant}
                          keyboardType="numeric"
                          value={examDuration}
                          onChangeText={setExamDuration}
                          style={{ 
                            backgroundColor: "#111111",
                            padding: 12, 
                            borderRadius: 8, 
                            fontSize: 14,
                            color: COLORS.onSurface,
                            borderWidth: 1,
                            borderColor: COLORS.border
                          }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ marginBottom: 8, fontWeight: "500", fontSize: 12, color: COLORS.onSurfaceVariant }}>Gap (mins)</Text>
                        <TextInput
                          placeholder="15"
                          placeholderTextColor={COLORS.onSurfaceVariant}
                          keyboardType="numeric"
                          value={examGap}
                          onChangeText={setExamGap}
                          style={{ 
                            backgroundColor: "#111111",
                            padding: 12, 
                            borderRadius: 8, 
                            fontSize: 14,
                            color: COLORS.onSurface,
                            borderWidth: 1,
                            borderColor: COLORS.border
                          }}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Templates */}
                  <View style={{ marginBottom: 20 }}>
                    <Text style={{ marginBottom: 8, fontWeight: "600", fontSize: 14, color: COLORS.onSurfaceVariant }}>Quick Templates</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {examScheduleTemplates.map((template, index) => (
                          <Pressable
                            key={index}
                            onPress={() => {
                              setExamsPerDay(template.examsPerDay);
                              setExamDuration(template.duration);
                              setExamGap(template.gap);
                              setExamStartTime(template.startTime);
                            }}
                            style={{ 
                              backgroundColor: COLORS.primary + "20", 
                              padding: 10, 
                              borderRadius: 8, 
                              minWidth: 100,
                              alignItems: "center",
                              borderWidth: 1,
                              borderColor: COLORS.primary + "30"
                            }}
                          >
                            <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700", marginBottom: 2 }}>
                              {template.name}
                            </Text>
                            <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 10 }}>
                              {template.examsPerDay}/day • {template.duration}h
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {/* Action Buttons */}
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <Pressable 
                      onPress={() => setShowExamScheduleModal(false)}
                      style={{ 
                        flex: 1, 
                        padding: 14, 
                        backgroundColor: COLORS.surfaceVariant, 
                        borderRadius: 8, 
                        alignItems: "center",
                        flexDirection: "row",
                        justifyContent: "center",
                        gap: 6
                      }}
                    >
                      <MaterialIcons name="close" size={16} color={COLORS.onSurface} />
                      <Text style={{ color: COLORS.onSurface, fontWeight: "600" }}>Cancel</Text>
                    </Pressable>
                    <Pressable 
                      onPress={generateExamSchedule}
                      style={{ 
                        flex: 2, 
                        padding: 14, 
                        backgroundColor: COLORS.accent, 
                        borderRadius: 8, 
                        alignItems: "center",
                        flexDirection: "row",
                        justifyContent: "center",
                        gap: 6
                      }}
                    >
                      <MaterialIcons name="schedule" size={16} color={COLORS.onSurface} />
                      <Text style={{ color: COLORS.onSurface, fontWeight: "800" }}>Generate Schedule</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Date and Time Pickers */}
          {showStartTimePicker && (
            <DateTimePicker
              value={startTimeDate}
              mode="time"
              is24Hour={false}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onStartTimeChange}
            />
          )}

          {showEndTimePicker && (
            <DateTimePicker
              value={endTimeDate}
              mode="time"
              is24Hour={false}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onEndTimeChange}
            />
          )}

          {showStartDatePicker && (
            <DateTimePicker
              value={examStartDateObj}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onExamStartDateChange}
            />
          )}

          {showEndDatePicker && (
            <DateTimePicker
              value={examEndDateObj}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onExamEndDateChange}
            />
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
