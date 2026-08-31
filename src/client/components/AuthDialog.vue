<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import AppSwitch from '~/components/AppSwitch.vue'
import DialogButton from '~/components/DialogButton.vue'
import DialogInput from '~/components/DialogInput.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { authLogin, authRegister, authVerify, AuthError } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { useCountdown } from '~/composables/useCountdown'
import { EMAIL_PATTERN, PASSWORD_MIN_LENGTH } from '@/shared/protocol'

const emit = defineEmits<{ close: [] }>()

const { email, loggedIn, emailVisible, setSession, setEmailVisible, logout } = useAuth()

const visible = computed({
  get: () => emailVisible.value,
  set: (value: boolean) => setEmailVisible(value),
})

const tab = ref<'login' | 'register'>('login')
const emailInput = ref('')
const passwordInput = ref('')
const codeInput = ref('')
const sent = ref(false)
const busy = ref(false)
const error = ref('')
const resendDeadline = ref<number | null>(null)
const resendLeft = useCountdown(resendDeadline, 60)

watch(tab, () => {
  error.value = ''
})

const MESSAGES: Record<string, string> = {
  email_invalid: '邮箱格式不正确',
  email_taken: '该邮箱已注册，请直接登录',
  cooldown: '发送太频繁，请稍后再试',
  email_failed: '邮件发送失败，请稍后再试',
  code_invalid: '验证码错误',
  code_expired: '验证码已失效，请重新发送',
  password_short: `密码至少 ${PASSWORD_MIN_LENGTH} 位`,
  bad_credentials: '邮箱或密码错误',
}

function messageFor(err: unknown): string {
  if (err instanceof AuthError && MESSAGES[err.code]) return MESSAGES[err.code]
  return '操作失败，请稍后重试'
}

function validate(): string {
  if (!EMAIL_PATTERN.test(emailInput.value.trim())) return MESSAGES.email_invalid
  if (tab.value === 'register' && !sent.value) return ''
  if (passwordInput.value.length < PASSWORD_MIN_LENGTH) return MESSAGES.password_short
  return ''
}

async function sendCode() {
  await authRegister(emailInput.value.trim())
  sent.value = true
  resendDeadline.value = Date.now() + 60_000
}

async function resend() {
  if (busy.value || (resendLeft.value ?? 0) > 0) return
  error.value = ''
  busy.value = true
  try {
    await sendCode()
  } catch (err) {
    error.value = messageFor(err)
  } finally {
    busy.value = false
  }
}

async function submit() {
  if (busy.value) return
  error.value = validate()
  if (error.value) return
  busy.value = true
  try {
    if (tab.value === 'login') {
      setSession(await authLogin(emailInput.value.trim(), passwordInput.value))
      emit('close')
    } else if (!sent.value) {
      await sendCode()
    } else {
      setSession(await authVerify(emailInput.value.trim(), codeInput.value, passwordInput.value))
      emit('close')
    }
  } catch (err) {
    error.value = messageFor(err)
  } finally {
    busy.value = false
  }
}

async function handleLogout() {
  await logout()
  emit('close')
}
</script>

<template>
  <AppDialog :title="loggedIn ? '我的账号' : '登录 / 注册'" @close="emit('close')">
    <template v-if="loggedIn">
      <p class="text-sm text-stone-600 dark:text-stone-300">{{ email }}</p>
      <div class="flex flex-col gap-1">
        <AppSwitch v-model="visible">允许他人查看我的完整邮箱</AppSwitch>
        <p class="text-xs text-stone-400 dark:text-stone-500">作用于对局、排行榜与每日大赛的邮箱显示</p>
      </div>
    </template>

    <template v-else>
      <div class="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-700/50">
        <button
          v-for="option in [
            { key: 'login', label: '登录' },
            { key: 'register', label: '注册' },
          ] as const"
          :key="option.key"
          class="cursor-pointer rounded-lg py-1.5 text-sm font-medium transition-colors"
          :class="
            tab === option.key
              ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-800 dark:text-stone-100'
              : 'text-stone-500 dark:text-stone-400'
          "
          @click="tab = option.key"
        >
          {{ option.label }}
        </button>
      </div>

      <DialogInput
        v-model="emailInput"
        type="email"
        placeholder="邮箱"
        autocomplete="email"
        :disabled="tab === 'register' && sent"
      />

      <template v-if="tab === 'login'">
        <DialogInput
          v-model="passwordInput"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
          @keyup.enter="submit"
        />
      </template>

      <template v-else-if="sent">
        <DialogInput
          v-model="codeInput"
          inputmode="numeric"
          maxlength="6"
          placeholder="邮箱验证码"
        />
        <DialogInput
          v-model="passwordInput"
          type="password"
          :placeholder="`设置密码（至少 ${PASSWORD_MIN_LENGTH} 位）`"
          autocomplete="new-password"
          @keyup.enter="submit"
        />
        <p class="flex items-center justify-between text-xs text-stone-400 dark:text-stone-500">
          验证码已发送至邮箱
          <button
            class="cursor-pointer text-stone-500 disabled:cursor-default disabled:opacity-60 dark:text-stone-400"
            :disabled="(resendLeft ?? 0) > 0"
            @click="resend"
          >
            {{ (resendLeft ?? 0) > 0 ? `重新发送（${resendLeft}s）` : '重新发送' }}
          </button>
        </p>
      </template>

      <p v-if="error" class="text-xs text-red-500 dark:text-red-400">{{ error }}</p>
    </template>

    <template #footer>
      <DialogButton v-if="loggedIn" variant="danger" @click="handleLogout">退出登录</DialogButton>
      <DialogButton v-else @click="submit">
        <IconSpinner v-if="busy" class="size-4" />
        {{ tab === 'login' ? '登录' : sent ? '注册并登录' : '发送验证码' }}
      </DialogButton>
    </template>
  </AppDialog>
</template>
