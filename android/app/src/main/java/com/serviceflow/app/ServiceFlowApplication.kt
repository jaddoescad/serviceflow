package com.serviceflow.app

import android.app.Application
import android.text.format.DateFormat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.serviceflow.core.DateText

class ServiceFlowApplication : Application() {
    /** The one app model, for the activity and the notification receiver. */
    lateinit var model: AppModel
        private set

    override fun onCreate() {
        super.onCreate()
        // Device date formats ("1:51 PM", "Sat, Oct 3"), as iOS templates give.
        DateText.bestPattern = { template, locale -> DateFormat.getBestDateTimePattern(locale, template) }
        model = AppModel(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = model.foregroundChanged(true)
            override fun onStop(owner: LifecycleOwner) = model.foregroundChanged(false)
        })
    }
}
