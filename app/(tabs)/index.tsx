import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// --- Types ---
type IntervalUnit = 'days' | 'weeks' | 'months';

type ContactItem = {
  id: string;
  name: string;
  nextDue: number;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  notificationId?: string | null;
  context?: string;
};

// --- Constants ---
const STORAGE_KEY = 'FOLLOW_UP_DATA';
const DAY_MS = 86400000;
const CONTEXT_LIMIT = 30;

// --- Notification Handler ---
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  } as Notifications.NotificationBehavior),
});

const getMsFromInterval = (value: number, unit: IntervalUnit) => {
  if (unit === 'days') return value * DAY_MS;
  if (unit === 'weeks') return value * 7 * DAY_MS;
  return value * 30 * DAY_MS;
};

export default function Index() {
  const [data, setData] = useState<ContactItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<IntervalUnit>('months');
  const [contextInput, setContextInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');

  const getNow = () => Date.now();

  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        setData(stored ? JSON.parse(stored) : []);
      } catch (e) {
        setData([]);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    const requestPermissions = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    };
    requestPermissions();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const scheduleNotificationForItem = async (item: ContactItem): Promise<string | null> => {
    if (item.notificationId) {
      try { await Notifications.cancelScheduledNotificationAsync(item.notificationId); } catch (e) {}
    }

    const secondsUntilDue = Math.floor((item.nextDue - Date.now()) / 1000);
    const triggerSeconds = secondsUntilDue > 0 ? secondsUntilDue : 2;

    try {
      return await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Follow up',
          body: `${item.name} is due for a follow up`,
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: triggerSeconds,
        },
      });
    } catch (e) {
      return null;
    }
  };

  const applyScheduleNow = async (item: ContactItem, val: number, unit: IntervalUnit, ctx?: string): Promise<ContactItem> => {
    const updated: ContactItem = {
      ...item,
      intervalValue: val,
      intervalUnit: unit,
      nextDue: getNow() + getMsFromInterval(val, unit),
      context: ctx?.trim() || undefined,
    };
    updated.notificationId = await scheduleNotificationForItem(updated);
    return updated;
  };

  const handleFollowUp = async (id: string) => {
    const updated = await Promise.all(data.map(async (item) => 
      item.id === id ? await applyScheduleNow(item, item.intervalValue, item.intervalUnit, item.context) : item
    ));
    setData(updated);
  };

  const handleSetInterval = async (id: string, unit: IntervalUnit, value: number) => {
    const updated = await Promise.all(data.map(async (item) => 
      item.id === id ? await applyScheduleNow(item, value, unit, contextInput) : item
    ));
    setData(updated);
    setEditingId(null);
    setContextInput('');
  };

  const handleAddContact = async () => {
    if (!newName.trim()) return;
    const realNow = Date.now();
    let newContact: ContactItem = {
      id: String(realNow),
      name: newName.trim(),
      nextDue: realNow,
      intervalValue: 1,
      intervalUnit: 'months',
    };
    newContact.notificationId = await scheduleNotificationForItem(newContact);
    setData((current) => [newContact, ...current]);
    setNewName('');
    setShowAdd(false);
  };

  const getDayBucket = (nextDue: number) => {
    const now = new Date(getNow());
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + DAY_MS;
    if (nextDue < startOfToday) return 'overdue';
    if (nextDue < endOfToday) return 'today';
    return 'upcoming';
  };

  const getStatusText = (item: ContactItem) => {
    const bucket = getDayBucket(item.nextDue);
    if (bucket === 'overdue') return 'Follow up when you can';
    if (bucket === 'today') return 'Follow up today';
    const days = Math.ceil((item.nextDue - getNow()) / DAY_MS);
    return `Follow up in ${days} day${days === 1 ? '' : 's'}`;
  };

  const renderRow = (item: ContactItem) => (
    <View key={item.id} style={styles.card}>
      <Text style={styles.name}>{item.name}</Text>
      {item.context && <Text style={styles.contextText}>Re: {item.context}</Text>}
      <Text style={styles.status}>{getStatusText(item)}</Text>
      <View style={styles.mainActions}>
        <TouchableOpacity onPress={() => handleFollowUp(item.id)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Followed up</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => { setEditingId(item.id); setSelectedUnit(item.intervalUnit); setContextInput(item.context || ''); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Set</Text></TouchableOpacity>
      </View>
    </View>
  );

  const overdue = data.filter(i => getDayBucket(i.nextDue) === 'overdue').sort((a,b) => a.nextDue - b.nextDue);
  const today = data.filter(i => getDayBucket(i.nextDue) === 'today').sort((a,b) => a.nextDue - b.nextDue);
  const upcoming = data.filter(i => getDayBucket(i.nextDue) === 'upcoming').sort((a,b) => a.nextDue - b.nextDue);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Follup</Text>
        <TouchableOpacity onPress={() => setShowAdd(!showAdd)} style={styles.addButton}><Text style={styles.addButtonText}>+ Add Contact</Text></TouchableOpacity>
        {showAdd && (
          <View style={styles.addBox}>
            <TextInput value={newName} onChangeText={setNewName} style={styles.input} placeholder="Name" returnKeyType="done" onSubmitEditing={handleAddContact} autoFocus />
            <TouchableOpacity onPress={handleAddContact} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Save</Text></TouchableOpacity>
          </View>
        )}
        {data.length === 0 ? (
          <View style={styles.emptyState}><Text style={styles.emptyTitle}>Welcome to Follup</Text><Text style={styles.emptySubtitle}>Tap + Add Contact to get started.</Text></View>
        ) : (
          <>
            {overdue.length > 0 && <View style={styles.section}><Text style={styles.sectionTitle}>Reach out</Text>{overdue.map(renderRow)}</View>}
            {today.length > 0 && <View style={styles.section}><Text style={styles.sectionTitle}>Today</Text>{today.map(renderRow)}</View>}
            {upcoming.length > 0 && <View style={styles.section}><Text style={styles.sectionTitle}>Upcoming</Text>{upcoming.map(renderRow)}</View>}
          </>
        )}
      </ScrollView>
      <Modal visible={!!editingId} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} onPress={() => setEditingId(null)} />
          <View style={styles.setSheet}>
            <Text style={styles.sheetTitle}>Set follow up</Text>
            <View style={styles.unitRow}>{(['days', 'weeks', 'months'] as IntervalUnit[]).map(u => (
              <TouchableOpacity key={u} onPress={() => setSelectedUnit(u)} style={[styles.choiceButton, selectedUnit === u && styles.choiceButtonSelected]}><Text style={[styles.choiceButtonText, selectedUnit === u && styles.choiceButtonTextSelected]}>{u}</Text></TouchableOpacity>
            ))}</View>
            <View style={styles.valueWrap}>{[1, 2, 3, 4, 7, 10, 14, 30].map(v => (
              <TouchableOpacity key={v} onPress={() => editingId && handleSetInterval(editingId, selectedUnit, v)} style={styles.valueButton}><Text style={styles.valueButtonText}>{v}</Text></TouchableOpacity>
            ))}</View>
            <View style={styles.contextBox}><Text style={styles.contextLabel}>Re:</Text><TextInput value={contextInput} onChangeText={setContextInput} placeholder="brief context" style={styles.contextInput} maxLength={CONTEXT_LIMIT} /></View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1EDE5' },
  container: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: '700', marginBottom: 24, color: '#1F2933' },
  addButton: { backgroundColor: '#244C5A', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 8, marginBottom: 24, alignItems: 'center' },
  addButtonText: { color: '#FBF8F1', fontWeight: '600' },
  addBox: { marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#B8B2A6', backgroundColor: '#FBF8F1', padding: 12, borderRadius: 8, marginBottom: 10, color: '#1F2933' },
  emptyState: { marginTop: 60, alignItems: 'center' },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#1F2933' },
  emptySubtitle: { color: '#6F6A61', fontSize: 15, textAlign: 'center' },
  section: { marginBottom: 24 },
  sectionTitle: { fontWeight: '600', fontSize: 14, color: '#6F6A61', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: '#FBF8F1', borderRadius: 14, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#D8D1C5' },
  name: { fontSize: 19, fontWeight: '700', color: '#1F2933' },
  contextText: { color: '#6F6A61', marginTop: 4, fontSize: 14, fontStyle: 'italic' },
  status: { color: '#6F6A61', marginTop: 6, marginBottom: 18, fontSize: 14 },
  mainActions: { flexDirection: 'row', gap: 10 },
  primaryButton: { backgroundColor: '#244C5A', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  primaryButtonText: { color: '#FBF8F1', fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: '#B8B2A6', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#FBF8F1' },
  secondaryButtonText: { color: '#244C5A', fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(31, 41, 51, 0.35)' },
  setSheet: { backgroundColor: '#FBF8F1', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, borderWidth: 1, borderColor: '#D8D1C5' },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#1F2933', marginBottom: 16 },
  unitRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  choiceButton: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#B8B2A6', borderRadius: 8, backgroundColor: '#FBF8F1' },
  choiceButtonSelected: { backgroundColor: '#244C5A', borderColor: '#244C5A' },
  choiceButtonText: { color: '#1F2933', fontWeight: '600' },
  choiceButtonTextSelected: { color: '#FBF8F1' },
  valueWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  valueButton: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#B8B2A6', borderRadius: 8, backgroundColor: '#FBF8F1' },
  valueButtonText: { color: '#1F2933', fontWeight: '600' },
  contextBox: { marginTop: 18, borderTopWidth: 1, borderTopColor: '#E2DDD4', paddingTop: 14 },
  contextLabel: { fontSize: 13, color: '#6F6A61', marginBottom: 6 },
  contextInput: { borderWidth: 1, borderColor: '#B8B2A6', backgroundColor: '#FBF8F1', padding: 10, borderRadius: 8, color: '#1F2933' },
});