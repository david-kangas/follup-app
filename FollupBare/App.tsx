import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Contacts from 'expo-contacts';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type IntervalUnit = 'days' | 'weeks' | 'months';

type ContactItem = {
  id: string;
  name: string;
  nextDue: number;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  context?: string;
  reminderHour?: number;
  reminderMinute?: number;
  hasCustomTime?: boolean;
};

const STORAGE_KEY = 'FOLLUP_APP_DATA_PIXEL_PERFECT';
const DAY_MS = 86400000;
const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_REMINDER_MINUTE = 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [data, setData] = useState<ContactItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [nameBuf, setNameBuf] = useState('');
  const [contextBuf, setContextBuf] = useState('');
  const [unitBuf, setUnitBuf] = useState<IntervalUnit>('weeks');
  const [phoneContacts, setPhoneContacts] = useState<Contacts.Contact[]>([]);

  const [reminderHourBuf, setReminderHourBuf] = useState(DEFAULT_REMINDER_HOUR);
  const [reminderMinuteBuf, setReminderMinuteBuf] = useState(DEFAULT_REMINDER_MINUTE);
  const [hasCustomTimeBuf, setHasCustomTimeBuf] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) setData(JSON.parse(stored));
      } catch (e) {
        console.warn('Error loading data:', e);
      } finally {
        setHasLoaded(true);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(e => {
      console.warn('Error saving data:', e);
    });
  }, [data, hasLoaded]);

  const loadContacts = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();

      if (status !== 'granted') {
        console.log('Contacts permission not granted');
        return;
      }

      const result = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.Name,
        ],
      });

      console.log('Contacts loaded:', result.data.length);
      setPhoneContacts(result.data);
    } catch (e) {
      console.log('Failed to load contacts:', e);
    }
  };

  const getContactDisplayName = (contact: Contacts.Contact) => {
    const fullName = contact.name?.trim();
    if (fullName) return fullName;

    return [contact.firstName, contact.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
  };

  const contactSuggestions = phoneContacts
    .filter(contact => {
      const searchText = nameBuf.trim().toLowerCase();
      const contactName = getContactDisplayName(contact).toLowerCase();

      return searchText.length >= 2 && contactName.includes(searchText);
    })
    .slice(0, 5);

  const addIntervalToDate = (
    baseDate: Date,
    value: number,
    unit: IntervalUnit
  ) => {
    const next = new Date(baseDate);

    if (unit === 'days') next.setDate(next.getDate() + value);
    if (unit === 'weeks') next.setDate(next.getDate() + value * 7);
    if (unit === 'months') next.setMonth(next.getMonth() + value);

    return next;
  };

  const buildNextDue = (
    value: number,
    unit: IntervalUnit,
    hour: number,
    minute: number
  ) => {
    const now = new Date();
    const next = addIntervalToDate(now, value, unit);
    next.setHours(hour, minute, 0, 0);
    return next.getTime();
  };

  const applyTimeToExistingDueDate = (
    nextDue: number,
    hour: number,
    minute: number
  ) => {
    const next = new Date(nextDue);
    next.setHours(hour, minute, 0, 0);
    return next.getTime();
  };

  const formatTime = (hour: number, minute: number) => {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);

    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const schedule = async (item: ContactItem) => {
    try {
      const existing = await Notifications.getPermissionsAsync();
      let finalStatus = existing.status;

      if (finalStatus !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }

      if (finalStatus !== 'granted') {
        console.log('Notification permissions not granted');
        return;
      }

      const triggerDate = new Date(item.nextDue);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Follup',
          body: `Check in with ${item.name}`,
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
    } catch (e) {
      console.log('Notification failed:', e);
    }
  };

  const handleSave = async (selectedVal: number, existingId?: string) => {
    if (!nameBuf.trim()) return;

    const nextDue = buildNextDue(
      selectedVal,
      unitBuf,
      reminderHourBuf,
      reminderMinuteBuf
    );

    const newItem: ContactItem = {
      id: existingId || String(Date.now()),
      name: nameBuf.trim(),
      context: contextBuf.trim() || undefined,
      intervalValue: selectedVal,
      intervalUnit: unitBuf,
      nextDue,
      reminderHour: reminderHourBuf,
      reminderMinute: reminderMinuteBuf,
      hasCustomTime: hasCustomTimeBuf,
    };

    setData(
      existingId
        ? data.map(i => (i.id === existingId ? newItem : i))
        : [newItem, ...data]
    );

    await schedule(newItem);
    closeAll();
  };

  const handleSaveChanges = async () => {
    if (!expandedId || !nameBuf.trim()) return;

    const existingItem = data.find(i => i.id === expandedId);
    if (!existingItem) return;

    const updated: ContactItem = {
      ...existingItem,
      name: nameBuf.trim(),
      context: contextBuf.trim() || undefined,
      reminderHour: reminderHourBuf,
      reminderMinute: reminderMinuteBuf,
      hasCustomTime: hasCustomTimeBuf,
      nextDue: applyTimeToExistingDueDate(
        existingItem.nextDue,
        reminderHourBuf,
        reminderMinuteBuf
      ),
    };

    setData(data.map(i => (i.id === expandedId ? updated : i)));

    await schedule(updated);
    closeAll();
  };

  const handleFollowUp = async (item: ContactItem) => {
    const hour = item.reminderHour ?? DEFAULT_REMINDER_HOUR;
    const minute = item.reminderMinute ?? DEFAULT_REMINDER_MINUTE;

    const updated: ContactItem = {
      ...item,
      nextDue: buildNextDue(item.intervalValue, item.intervalUnit, hour, minute),
      reminderHour: hour,
      reminderMinute: minute,
      hasCustomTime: item.hasCustomTime ?? false,
    };

    setData(data.map(i => (i.id === item.id ? updated : i)));
    await schedule(updated);
  };

  const closeAll = () => {
    setIsAdding(false);
    setExpandedId(null);
    setConfirmDeleteId(null);
    setNameBuf('');
    setContextBuf('');
    setReminderHourBuf(DEFAULT_REMINDER_HOUR);
    setReminderMinuteBuf(DEFAULT_REMINDER_MINUTE);
    setHasCustomTimeBuf(false);
    setShowTimePicker(false);
  };

  const startAdd = () => {
    closeAll();
    setIsAdding(true);
    loadContacts();
  };

  const startEdit = (item: ContactItem) => {
    loadContacts();
    setExpandedId(item.id);
    setNameBuf(item.name);
    setContextBuf(item.context || '');
    setUnitBuf(item.intervalUnit);
    setReminderHourBuf(item.reminderHour ?? DEFAULT_REMINDER_HOUR);
    setReminderMinuteBuf(item.reminderMinute ?? DEFAULT_REMINDER_MINUTE);
    setHasCustomTimeBuf(item.hasCustomTime ?? false);
    setShowTimePicker(false);
    setIsAdding(false);
  };

  const getNumberRange = () => {
    if (unitBuf === 'weeks') return [1, 2, 3, 4];
    if (unitBuf === 'days') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  };

  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const endOfToday = startOfToday + DAY_MS;

  const sortedList = [...data].sort((a, b) => a.nextDue - b.nextDue);

  const getStatus = (item: ContactItem) => {
    if (item.nextDue < startOfToday) return 'Follow up';
    if (item.nextDue < endOfToday) return 'Today';

    const days = Math.ceil((item.nextDue - Date.now()) / DAY_MS);
    return `In ${days} ${days === 1 ? 'day' : 'days'}`;
  };

  const renderActiveEditor = (existingId?: string) => (
    <View key={existingId || 'new-contact'} style={[styles.card, styles.activeCard]}>
      <TextInput
        ref={nameInputRef}
        value={nameBuf}
        onChangeText={setNameBuf}
        style={styles.inputBold}
        placeholder="Name"
        autoFocus
      />

      {nameBuf.trim().length >= 2 && contactSuggestions.length > 0 && (
        <View style={styles.suggestionBox}>
          {contactSuggestions.map(contact => {
            const displayName = getContactDisplayName(contact);

            return (
              <TouchableOpacity
                key={contact.id}
                onPress={() => setNameBuf(displayName)}
                style={styles.suggestionItem}
              >
                <Text style={styles.suggestionText}>{displayName}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TextInput
        value={contextBuf}
        onChangeText={setContextBuf}
        style={styles.inputContext}
        placeholder="Re: Context"
      />

      <View style={styles.divider} />

      <View style={styles.timeSection}>
        <Text style={styles.timeLabel}>
          Time ·{' '}
          {hasCustomTimeBuf
            ? formatTime(reminderHourBuf, reminderMinuteBuf)
            : 'Default 9:00 AM'}
        </Text>

        <View style={styles.timeRow}>
          <TouchableOpacity
            style={styles.timeBtn}
            onPress={() => {
              const now = new Date();
              setReminderHourBuf(now.getHours());
              setReminderMinuteBuf(now.getMinutes());
              setHasCustomTimeBuf(true);
            }}
          >
            <Text style={styles.btnTextDark}>Use Current Time</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.timeBtn}
            onPress={() => setShowTimePicker(true)}
          >
            <Text style={styles.btnTextDark}>Pick Time</Text>
          </TouchableOpacity>
        </View>

        {showTimePicker && (
          <DateTimePicker
            value={
              new Date(
                new Date().setHours(reminderHourBuf, reminderMinuteBuf, 0, 0)
              )
            }
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selectedDate) => {
              if (Platform.OS === 'android') setShowTimePicker(false);

              if (selectedDate) {
                setReminderHourBuf(selectedDate.getHours());
                setReminderMinuteBuf(selectedDate.getMinutes());
                setHasCustomTimeBuf(true);
              }
            }}
          />
        )}
      </View>

      <View style={styles.divider} />

      <View style={styles.unitRow}>
        {(['days', 'weeks', 'months'] as IntervalUnit[]).map(u => (
          <TouchableOpacity
            key={u}
            onPress={() => setUnitBuf(u)}
            style={[styles.unitBtn, unitBuf === u && styles.unitBtnActive]}
          >
            <Text style={unitBuf === u ? styles.btnTextWhite : styles.btnTextDark}>
              {u}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.valRow}>
        {getNumberRange().map(v => (
          <TouchableOpacity
            key={v}
            onPress={() => handleSave(v, existingId)}
            style={styles.valBtn}
          >
            <Text style={styles.btnTextDark}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {existingId && (
        <TouchableOpacity onPress={handleSaveChanges} style={styles.saveChangesBtn}>
          <Text style={styles.btnTextWhite}>Save Changes</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={closeAll} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCard = (item: ContactItem, status: string) => {
    if (expandedId === item.id) return renderActiveEditor(item.id);

    const showCustomTime = item.hasCustomTime === true;
    const hour = item.reminderHour ?? DEFAULT_REMINDER_HOUR;
    const minute = item.reminderMinute ?? DEFAULT_REMINDER_MINUTE;

    return (
      <View key={item.id} style={styles.card}>
        <Text style={styles.cardName}>{item.name}</Text>

        {item.context && <Text style={styles.cardContext}>Re: {item.context}</Text>}

        <Text style={styles.statusText}>
          {status}
          {showCustomTime ? ` · ${formatTime(hour, minute)}` : ''}
        </Text>

        <View style={styles.primaryActionRow}>
          <TouchableOpacity onPress={() => handleFollowUp(item)} style={styles.btnTeal}>
            <Text style={styles.btnTextWhite}>Followed up</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => startEdit(item)} style={styles.btnSet}>
            <Text style={styles.btnTextDark}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.secondaryActionRow}>
          <View style={styles.editWrapper}>
            {confirmDeleteId === item.id ? (
              <TouchableOpacity onPress={() => setData(data.filter(i => i.id !== item.id))}>
                <Text style={styles.deleteConfirmText}>Confirm?</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setConfirmDeleteId(item.id)}>
                <Text style={styles.linkTextRed}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        {...(Platform.OS === 'android' && {
          disableScrollViewPanResponder: true,
          maintainVisibleContentPosition: { minIndexForVisible: 0 },
        })}
      >
        <Text style={styles.header}>Follup</Text>

        {!isAdding && !expandedId && (
          <TouchableOpacity onPress={startAdd} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+ Add Contact</Text>
          </TouchableOpacity>
        )}

        {isAdding && renderActiveEditor()}

        {sortedList.map(i => renderCard(i, getStatus(i)))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1EDE5' },
  scroll: { padding: 20, paddingTop: 60, paddingBottom: 100 },
  header: {
    fontSize: 34,
    fontWeight: '900',
    color: '#1F2933',
    marginBottom: 25,
  },
  addBtn: {
    backgroundColor: '#244C5A',
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    marginBottom: 20,
  },
  addBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 18,
  },
  card: {
    backgroundColor: '#FBF8F1',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    minHeight: 120,
    justifyContent: 'center',
  },
  activeCard: {
    borderColor: '#244C5A',
    borderWidth: 2,
    backgroundColor: '#FFF',
  },
  cardName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F2933',
    lineHeight: 32,
  },
  cardContext: {
    fontSize: 18,
    color: '#6F6A61',
    fontStyle: 'italic',
    marginTop: 2,
  },
  statusText: {
    fontSize: 13,
    color: '#6F6A61',
    marginTop: 4,
    marginBottom: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  primaryActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 5,
    marginBottom: 8,
  },
  btnTeal: {
    backgroundColor: '#244C5A',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    minWidth: 140,
    alignItems: 'center',
  },
  btnSet: {
    borderWidth: 1,
    borderColor: '#D8D1C5',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    backgroundColor: '#FFF',
    minWidth: 80,
    alignItems: 'center',
  },
  timeBtn: {
    borderWidth: 1,
    borderColor: '#D8D1C5',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFF',
    flex: 1,
    alignItems: 'center',
  },
  btnTextWhite: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
  btnTextDark: {
    color: '#244C5A',
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  editWrapper: {
    minWidth: 140,
    alignItems: 'flex-start',
    paddingLeft: 2,
  },
  linkTextRed: {
    color: '#B06A6A',
    fontWeight: '500',
    fontSize: 13,
  },
  deleteConfirmText: {
    color: '#FFF',
    backgroundColor: '#9B4444',
    padding: 4,
    borderRadius: 4,
    fontWeight: '800',
    fontSize: 16,
  },
  inputBold: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F2933',
    borderBottomWidth: 0,
    paddingBottom: 0,
    marginBottom: 4,
  },
  inputContext: {
    fontSize: 16,
    color: '#6F6A61',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2DDD4',
    marginVertical: 8,
  },
  suggestionBox: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D8D1C5',
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2DDD4',
  },
  suggestionText: {
    fontSize: 15,
    color: '#244C5A',
    fontWeight: '600',
  },
  timeSection: {
    marginBottom: 6,
  },
  timeLabel: {
    fontSize: 13,
    color: '#6F6A61',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  timeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  unitRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  unitBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    backgroundColor: '#FBF8F1',
  },
  unitBtnActive: {
    backgroundColor: '#244C5A',
    borderColor: '#244C5A',
  },
  valRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  valBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    minWidth: 38,
    alignItems: 'center',
  },
  saveChangesBtn: {
    backgroundColor: '#244C5A',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelBtn: {
    marginTop: 8,
    padding: 4,
  },
  cancelText: {
    textAlign: 'center',
    color: '#6F6A61',
    fontWeight: '700',
  },
});